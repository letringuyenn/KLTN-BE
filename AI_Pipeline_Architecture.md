# Tài Liệu Kỹ Thuật: Kiến Trúc Phân Tích Mã Nguồn Và Tự Động Tạo Pull Request

**Vai trò hệ thống:** AI CI/CD Pipeline Analyzer  
**Cụm tính năng chính:** Tiếp nhận URL/Repository, Phân tích mã nguồn bằng AI, Tự động sửa lỗi và Tạo Pull Request (Auto-create PR).

---

## 1. Tổng Quan Kỹ Thuật & Công Nghệ

Hệ thống được thiết kế theo kiến trúc Microservices/Worker-based nhằm đảm bảo tính toàn vẹn và khả năng xử lý bất đồng bộ, sử dụng các công nghệ cốt lõi sau:

### 1.1. Backend Framework & Quản lý Luồng (Node.js)

- **Runtime:** Node.js với `async/await` để xử lý các tác vụ I/O-intensive (clone code, gọi API, tương tác AI).
- **Message Queue:** (ví dụ: RabbitMQ, BullMQ, Redis) để quản lý hàng đợi phân tích (Analysis Jobs). Do quá trình phân tích mã nguồn và gọi LLM mất thời gian, hệ thống tiếp nhận request và đẩy vào Background Worker, tránh timeout cho HTTP Request của phía client.

### 1.2. Tích hợp AI (Large Language Models)

- **Engine:** Google Gemini AI (hoặc các LLM tiên tiến khác) đóng vai trò trung tâm trong quá trình đọc hiểu ngữ cảnh mã nguồn.
- **Vai trò:** Nhận diện Code Smells, Security Vulnerabilities, Logic Bugs và sinh ra các đoạn mã vá lỗi (patches/diffs) đảm bảo đúng conventions của repository hiện tại.

### 1.3. Version Control System (VCS) Integration

- **Giao tiếp API:** Tích hợp GitHub/GitLab REST hoặc GraphQL API.
- **Thư viện bên thứ ba (SDKs):** Sử dụng các SDK chính thức như `octokit` (GitHub) hoặc thao tác nguyên thủy qua `git` CLI module (như `simple-git`) để fetch code file-by-file, tạo branch, stage, commit và mở Pull Request.

---

## 2. Thuật Toán & Cơ Chế Phân Tích

Để LLM hoạt động hiệu quả trên các codebase lớn khổng lồ mà không vượt quá giới hạn Token Context Window, hệ thống kết hợp nhiều cơ chế xử lý dữ liệu tinh vi.

### 2.1. Trích xuất Code và Tiền xử lý

- **Shallow Clone / Sparse Checkout:** Thay vì clone toàn bộ history của repo, worker chỉ pull thư mục/nhánh được yêu cầu nhằm tiết kiệm băng thông và bộ nhớ. Hoặc hệ thống sử dụng GitHub Tree API lấy đệ quy các tệp mã nguồn.
- **AST Parsing (Abstract Syntax Tree):** Phân rã mã nguồn thành các hàm, lớp, module. Loại bỏ những tệp không liên quan (như `.png`, `package-lock.json`, `.gitignore`).
- **Semantic Chunking:** Cắt nhỏ file (chunking) theo cấu trúc hàm/lớp (ngữ nghĩa) thay vì cắt theo độ dài ký tự ngẫu nhiên.

### 2.2. Kết hợp Static Analysis & AI Prompting

Hệ thống sử dụng cơ chế **Hybrid Analysis**:

1. **Pha 1 - Rà soát tĩnh (Static Code Analysis):** Đi qua các công cụ lint/SAST tiêu chuẩn (như ESLint, SonarQube) để xác định sơ bộ vị trí tệp và mô hình hóa lỗi.
2. **Pha 2 - AI Deep Analysis:** Lấy đoạn mã bị gạch chân cùng context xung quanh đưa vào LLM với các System Prompts được tinh chỉnh khắt khe (Few-shot prompting / Chain-of-thought) để xác nhận lỗi và đưa xuất mã khắc phục.

Ví dụ Prompt Strategy (Giả mã):

```json
{
  "system_prompt": "You are an expert Secure Coding Engineer. Analyze the provided code for logic flaws and vulnerabilities. Provide the updated full method substituting the old one. Enclose the fixed code in triple backticks.",
  "user_prompt": "File: 'auth/jwt.js'. Detected issue: 'Hardcoded Secret Key'. Code content: ..."
}
```

---

## 3. Luồng Chạy Chức Năng (Execution Flow)

Luồng thực thi được chia thành một chuỗi các bước (Step-by-step) khép kín đối với một worker:

1. **Nhận Link & Xác thực (Receive & Authenticate):**
   - Hệ thống tiếp nhận URL Repository hoặc một URL Pull Request cụ thể.
   - Kiểm tra Token/OAuth App credentials để đảm bảo có quyền Đọc/Ghi.

2. **Fetch & Parse Code (Trích xuất):**
   - Lấy meta-data của repo (default branch, last commit SHA).
   - Fetch nội dung code cần xử lý.

3. **AI Analysis & Diff Generation (Phân tích & Tối ưu AI):**
   - Đẩy Code Chunks tới Gemini API.
   - Trích xuất code được AI sửa (Patches).
   - Map đoạn patch với file path tương ứng. Sinh file `.patch` hoặc map Object in-memory.

4. **Tạo Nhánh Mới (Create Branch):**
   - Tự động tạo một nhánh mới từ `main` (ví dụ: `ai-fix/vuln-jwt-auth-123`).

5. **Commit Các Thay Đổi (Commit Changes):**
   - Update/Overwrite (Ghi đè) tệp tại nhánh vừa tạo.
   - Sinh Commit Message bằng AI (VD: `fix(auth): Use environment variable for JWT secret`).
   - Push commit lên remote origin.

6. **Mở Pull Request (Open PR):**
   - Payload gọi GitHub API mở PR với Description chi tiết:
     - Tóm tắt lõi (What is fixed).
     - Nguyên nhân gốc rễ (Root cause found by AI).
     - Hướng dẫn cho Reviewer.

_Ví dụ Payload mở PR (GitHub):_

```json
{
  "title": "🤖 AI Auto-fix: Address Hardcoded Secrets and Optimizations",
  "body": "### AI Automated Fix\n- **Issue:** Hardcoded JWT Secret detected in `utils/auth.js`.\n- **Resolution:** Replaced with `process.env.JWT_SECRET`.\n\nPlease review these changes closely.",
  "head": "ai-fix/vuln-jwt-auth-123",
  "base": "main"
}
```

---

## 4. Xử Lý Ngoại Lệ (Edge Cases & Fallbacks)

Để hệ thống MLOps vận hành bền bỉ (resilient), mọi ngoại lệ đều phải có cơ chế xử lý dự phòng:

- **Link/Repo không hợp lệ (404/403):**
  - _Xử lý:_ Fail-fast ngay ở bước Authenticate, phản hồi lại webhook/UI là không có quyền truy cập hoặc repository không tồn tại.
- **Giới hạn API / Rate Limiting:**
  - _Xử lý:_ Cài đặt thuật toán _Exponential Backoff_ cho cả REST API của Git Provider và LLM. Đẩy Job ngược lại hàng đợi (Delayed Queue) để retry sau vài phút.
- **AI sinh code sai cú pháp (Syntax Errors/Hallucination):**
  - _Xử lý:_ Trước khi commit, Worker sẽ chạy một bước sandboxed syntax-check nội bộ (vd chạy AST parser hoặc `npm run build` tóm gọn). Nếu gãy, hệ thống phản hồi Prompt lại cho LLM (Self-correction) kèm theo lỗi cú pháp yêu cầu LLM sửa lại. Thất bại sau 3 lần thì hủy bỏ việc vá lỗi tại file đó để phòng rủi ro.
- **Git Merge Conflict (Xung đột với nhánh chính):**
  - _Xử lý:_ Do thời gian AI phân tích lâu, nhánh base có thể đã có code mới. Trước khi tạo PR, tự động rebase/sync với `main`. Nếu có conflict, hệ thống tạo PR ở trạng thái `Draft` và thêm comment cảnh báo Developer can thiệp xử lý conflict thủ công.
