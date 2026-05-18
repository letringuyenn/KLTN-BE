# Báo cáo Phân Tích Kiến Trúc Hệ thống: AI CI/CD Pipeline Analyzer

## Phần 1: Tổng quan kiến trúc và Thư viện

Hệ thống cung cấp một API server bất đồng bộ (asynchronous) hiệu năng cao được xây dựng trên **Node.js** và **Express.js (v5.2.1)**. Hệ thống tách biệt hoàn toàn layer API (nhận request) và layer xử lý AI/Logs nặng nề (Background Jobs) thông qua các Worker giúp tăng tính đáp ứng và toàn vẹn của ứng dụng.

**Các thư viện cốt lõi và mục đích sử dụng:**

- **Core Framework & Middleware:** `express` kết hợp cùng `cors`, `helmet` (bảo mật HTTP headers), `cookie-parser`, và `express-rate-limit` (phòng chống DDoS, limit requests).
- **Cơ sở dữ liệu (Database):** `mongoose` (v9) - ODM chính để kết nối, định nghĩa Schema và Query với MongoDB.
- **Tích hợp bên thứ ba (GitHub API):** `@octokit/rest` và `axios` dùng để gọi API của GitHub (pull code, get logs, tạo nhánh mới, commit, và tạo Pull Request).
- **Tích hợp Trí tuệ Nhân tạo (Gemini):** `@google/generative-ai` dùng để gửi lượng dữ liệu khổng lồ từ logs vào model Gemini phân tích và yêu cầu trả về nguyên nhân lỗi hoặc code vá lỗi.
- **Bảo mật & Mã hoá:** `jsonwebtoken` (JWT) dùng cho stateless authentication (xác thực không lưu state). Sử dụng tiện ích mã hoá tuỳ chỉnh `crypto` (AES-256-GCM) để mã hoá và giải mã các chuỗi nhạy cảm như `githubAccessToken` hay `Google Gemini API Key`.
- **Quản lý Background Jobs:** Quá trình phân tích CI/CD không chạy đồng bộ mà được điều hướng qua file độc lập `worker.js` / `src/workers/analysisWorker.js`. Hệ thống dùng `concurrently` để chạy song song Server và Worker trong lúc dev.

**Cấu trúc thư mục:**
Dự án áp dụng chặt chẽ mô hình **Controller - Service - Route (MVC không có View)** chuyên biệt lập trình RESTful API:

- `routes/`: Tiếp nhận HTTP Request và mapping vào các Controller.
- `controllers/`: Parsing Request (body, params), validate quyền truy cập và điều phối.
- `services/`: Chứa 100% Core Business Logic, tương tác Database, gọi External API (Github, Gemini).
- `models/`: Định nghĩa Mongoose schema và hooks.
- `utils/`: Các hàm hỗ trợ dùng chung (crypto, parser log).
- `workers/`: Chứa logic xử lý Job chạy ngầm độc lập với Express.

---

## Phần 2: Phân tích cấu trúc Cơ sở dữ liệu

Dự án dùng MongoDB thông qua Mongoose, với các Schema cốt lõi sau:

- **User Model (`src/models/User.js`)**
  - Schema lưu trữ thông tin định danh: `githubId`, `username`, `avatar`.
  - Quản lý Secret: `githubAccessToken` (luôn lưu định dạng mã hoá để tránh lộ hàng loạt nếu rò rỉ DB) và `encryptedGeminiApiKey` (cho phép người dùng tự dùng Key cá nhân).
  - Quản lý Tài nguyên/Phân quyền: `role` (`USER`, `ADMIN`), `tier` (`FREE`, `PRO`), `analyzeCount` đếm số lần sử dụng AI trong kỳ.
  - _Hooks:_ Tích hợp middleware Pre-validation kiểm tra nếu role cấp là `ADMIN` sẽ tự động bypass quota limit, chuyển thành `PRO`.

- **AnalysisJob Model (`src/models/AnalysisJob.js`)**
  - Đây là "Trái tim" của hệ thống Queue. Lưu trữ trạng thái luồng tiến trình phân tích với field `status` (`pending`, `processing`, `completed`, `failed`).
  - Liên kết với user thông qua `userId`, chứa `payload` (bao gồm `repoUrl`, `workflowRunId`) và sau cùng chứa kết quả do AI phân tích ghi lại ở trường `result`.
  - _Index:_ Đánh compound index trên `{ status: 1, createdAt: 1 }` giúp cho các Background Polling Workers query ra các job pending siêu tốc.

- **Các collection phụ trợ:**
  - `KnowledgeBase`: Đóng vai trò như database tĩnh cho giải pháp RAG, cung cấp thông tin thêm vào Prompt (thường được đánh text-search index).
  - `Feedback` / `Transaction`: Lưu trữ đánh giá AI và hệ thống nạp thẻ tier.
  - `AnalysisLog`: Schema chuyên biệt chi tiết việc cache log của github tránh fetch quá nhiều lần.

---

## Phần 3: Phân tích luồng dữ liệu cốt lõi Core Flows

### 1. Luồng Xác thực GitHub OAuth và cấp phát JWT

1. Frontend gọi `GET /api/auth/github/login` mang theo state bảo mật do frontend sinh.
2. `authController` redirect trình duyệt tới trang xác thực chuẩn của GitHub (Yêu cầu cấp quyền read scopes và repository workflows).
3. Người dùng đồng ý, GitHub redirect trình duyệt về frontend, frontend sau đó gọi `POST /api/auth/github/callback` kèm đoạn `code` uỷ quyền.
4. Backend nhận `code`, bọc trong hàm của Axios đổi lấy `access_token` từ GitHub API.
5. Sau khi lấy token và thông tin Github Account, `authController` gọi `utils/crypto.js` mã hoá AES-256-GCM token đó lại và lưu cập nhật tại Document User.
6. Backend ký (sign) ra một chuỗi JWT lưu vào HTTP-only Cookies trả cho trình duyệt.

### 2. Luồng tạo Analysis Job & Google Gemini AI (Bất đồng bộ)

1. Frontend gọi `POST /api/analysis/analyze` đưa lên `repoUrl` và `workflowRunId`.
2. `analysisController` kiểm tra `User` lấy `githubAccessToken`, giải mã nó ra, tiêm vào Payload. Chèn một document `AnalysisJob` với trạng thái `pending`. Trả về `202 Accepted` kèm `jobId`.
3. Background Worker (`analysisWorker.js`) đang trong vòng lặp vô hạn `setInterval` query các DB document mang nhãn `pending`. Nó bốc dỡ job và đổi trạng thái thành `processing`.
4. Worker gọi `githubService` để download nén Log (Zip) từ API Github, giải nén và lọc ra các dòng log báo lỗi cốt lõi.
5. Log lỗi được chèn vào prompt và đẩy qua `aiService`, gọi tới mô hình `gemini-2.5-flash`.
6. `aiService` hứng context result json, Worker catch lấy JSON này ghi đè lên field `result` của mô hình Job và đổi trạng thái sang `completed`. Frontend lấy được kết quả qua cơ chế polling hoặc websocket (SSE).

### 3. Luồng tạo Auto-Fix Pull Request

1. Dựa vào JSON mà Gemini phân tích, sẽ có phần AI đề xuất nội dung vá lỗi (Patch data content + files).
2. Frontend truyền tín hiệu "Approve" Patch này. Backend gọi một endpoint mở PR (Auto-Fix PR).
3. `githubService` sử dụng Octokit REST Client, cầm Access Token của user đang online (User Owner).
4. Logic: API tự động kéo sha của nhánh default/master -> rẽ nhanh tạo mới một nhánh tên ví dụ (ai-fix-1234) -> đẩy nội dung ghi đè lên file trên nhánh mới đó làm commit payload -> Create một Pull Request từ nhánh ai-fix-1234 sang master nhánh.

---

## Phần 4: Giải thích chi tiết từng Controller và Service

### File `src/controllers/authController.js`

- **Chức năng:** Quản lý quy trình Handshake OAuth2.0, cấp token và lấy context User Authentication.
- **Giải thích Code:**
  Code lấy `code` từ Request Body, gọi fetch sang Github để lấy `access_token`. Khi lấy xong, dữ liệu được truyền vào Service lưu vào db.
  ```javascript
  // Trích đoạn logic mã hóa AES tại Crypto
  const encryptedToken = cryptoUtils.encrypt(githubAccessToken);
  await User.findOneAndUpdate(
    { githubId },
    { githubAccessToken: encryptedToken },
    { upsert: true },
  );
  ```
  Việc sử dụng mã hoá bất đối xứng giúp db an toàn, Controller không chứa quá nhiều logic fetch Github mà outsource chức năng sinh URL và exchange ra Helper.
- **Liên kết:** Input từ `authRoutes.js` (`POST /callback`), lưu thông tin User model. Trả về Cookies JWT.

### File `src/services/githubService.js` / Hàm `fetchFailedWorkflowLogs`

- **Chức năng:** Service trừu tượng hóa Github API, dùng quản lý Repos, download logs, thao tác Branches.
- **Giải thích Code:**
  Bao gồm hàm `resolveRunId` dùng Octokit tìm fetch tự động RunId bị gãy cuối cùng nếu FE báo biến `latest`. Hàm download logs sử dụng cơ chế raw fetching.
  ```javascript
  const octokit = new Octokit({ auth: decryptedToken });
  const response = await octokit.actions.downloadWorkflowRunLogs({
    owner,
    repo,
    run_id: runId,
  });
  ```
- **Liên kết:** Được gọi bởi `analysisWorker.js` và `analysisController.js`. Nếu API rate-limit xả lỗi, sẽ handle map error qua lớp `mapOctokitError`.

### File `src/services/aiService.js`

- **Chức năng:** Bộ não logic chính kết nối Google Gemini 2.5 để phân tích lỗi.
- **Giải thích Code:**
  Sử dụng kỹ thuật RAG tối giản: Trước khi parse chuỗi Log để prompt cho Gemini, hàm chạy text-search của Mongoose trích text base trong KnowledgeBase.
  Hàm Fallback:
  ```javascript
  if (error.status === 429) {
    // Quota Limit Google AI
    return fallbackHeuristicsAnalysis(parsedLogs);
  }
  ```
  Nếu bị giới hạn API từ phía Google, code sẽ kích hoạt `analyzeWithHeuristics` dùng RegExp phân tách regex thường gặp (`enoent`, `permission denied`) vớt vát độ ổn định thay vì trả 500 cho khách hàng.
- **Liên kết:** Được `analysisWorker.js` gọi độc quyền, không dùng trực tiếp ở HTTP Controller.

### File `src/controllers/analysisController.js`

- **Chức năng:** Nhận yêu cầu tạo job, lấy thông tin job và check lịch sử jobs.
- **Giải thích Code:**
  Hàm tạo Job `POST` chỉ thực hiện thao tác Validate quyền, tiêm userId và payload, đóng gói `job.save()` trạng thái 'pending' rồi lập tức trả `res.status(202).json({ jobId })`. Hàm không chạy delay.
  Hàm lấy History, gọi `AnalysisJob.find({ userId: req.user._id })` với phân tích xác thực RBAC để Users chỉ lấy được dữ liệu của chính mình (Admin được override nếu cần).
- **Liên kết:** Đầu vào từ `analysisRoutes.js`, tương tác `AnalysisJob` Model, trả về JSON.
