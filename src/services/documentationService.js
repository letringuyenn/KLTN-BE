const mongoose = require("mongoose");
const Documentation = require("../models/Documentation");

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return undefined;
}

function mapDocumentationDoc(doc) {
  if (!doc) {
    return null;
  }

  const slug =
    (typeof doc.slug === "string" && doc.slug.trim()) ||
    (typeof doc.sectionId === "string" && doc.sectionId.trim()) ||
    slugify(doc.title) ||
    String(doc._id || "");

  return {
    ...doc,
    slug,
    category:
      typeof doc.category === "string" && doc.category.trim()
        ? doc.category.trim()
        : "Uncategorized",
    isPublished: doc.isPublished !== false,
  };
}

async function generateUniqueSlug(title, excludeId) {
  const baseSlug = slugify(title) || "documentation";
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const query = { slug: candidate };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const existing = await Documentation.findOne(query).select("_id").lean();
    if (!existing) {
      return candidate;
    }

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

async function getPublishedDocs() {
  const docs = await Documentation.find({
    $and: [
      { $or: [{ isPublished: true }, { isPublished: { $exists: false } }] },
      { $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }] },
    ],
  })
    .sort({ order: 1, createdAt: 1 })
    .lean();

  return Array.isArray(docs) ? docs.map(mapDocumentationDoc) : [];
}

async function getPublishedDocBySlug(slug) {
  if (!slug || !String(slug).trim()) {
    return null;
  }

  const doc = await Documentation.findOne({
    $and: [
      {
        $or: [
          { slug: String(slug).trim().toLowerCase() },
          { sectionId: String(slug).trim() },
        ],
      },
      {
        $or: [{ isPublished: true }, { isPublished: { $exists: false } }],
      },
      {
        $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }],
      },
    ],
  }).lean();

  return mapDocumentationDoc(doc);
}

async function getAdminDocs(page, limit) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(
    100,
    Math.max(1, Number.parseInt(limit, 10) || 20),
  );
  const skip = (safePage - 1) * safeLimit;

  const query = {
    $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }],
  };

  const [docs, total] = await Promise.all([
    Documentation.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Documentation.countDocuments(query),
  ]);

  return {
    docs: Array.isArray(docs) ? docs.map(mapDocumentationDoc) : [],
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}

async function getAdminDocById(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error("Invalid documentation id");
    error.status = 400;
    throw error;
  }

  const doc = await Documentation.findById(id).lean();
  if (!doc) {
    const error = new Error("Documentation not found");
    error.status = 404;
    throw error;
  }

  return mapDocumentationDoc(doc);
}

async function createAdminDoc(input) {
  const { title, content, category, isPublished } = input || {};

  if (typeof title !== "string" || !title.trim()) {
    const error = new Error("title is required");
    error.status = 400;
    throw error;
  }

  if (typeof content !== "string" || !content.trim()) {
    const error = new Error("content is required");
    error.status = 400;
    throw error;
  }

  const slug = await generateUniqueSlug(title.trim());

  const doc = await Documentation.create({
    title: title.trim(),
    slug,
    content: content.trim(),
    category:
      typeof category === "string" && category.trim()
        ? category.trim()
        : "Uncategorized",
    isPublished: parseBoolean(isPublished) === true,
  });

  const populated = await Documentation.findById(doc._id).lean();
  return mapDocumentationDoc(populated);
}

async function updateAdminDoc(id, input) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error("Invalid documentation id");
    error.status = 400;
    throw error;
  }

  const existing = await Documentation.findById(id);
  if (!existing) {
    const error = new Error("Documentation not found");
    error.status = 404;
    throw error;
  }

  const { title, content, category, isPublished } = input || {};
  const updatePayload = {};

  if (typeof title === "string" && title.trim()) {
    updatePayload.title = title.trim();
    updatePayload.slug = await generateUniqueSlug(title.trim(), id);
  }

  if (typeof content === "string" && content.trim()) {
    updatePayload.content = content.trim();
  }

  if (typeof category === "string") {
    updatePayload.category = category.trim() || "Uncategorized";
  }

  const publishedValue = parseBoolean(isPublished);
  if (typeof publishedValue === "boolean") {
    updatePayload.isPublished = publishedValue;
  }

  const updated = await Documentation.findByIdAndUpdate(
    id,
    {
      $set: updatePayload,
    },
    { new: true, runValidators: true },
  ).lean();

  return mapDocumentationDoc(updated);
}

async function deleteAdminDoc(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error("Invalid documentation id");
    error.status = 400;
    throw error;
  }

  const deleted = await Documentation.findByIdAndUpdate(
    id,
    { isDeleted: true, deletedAt: new Date() },
    { new: true },
  ).lean();

  if (!deleted) {
    const error = new Error("Documentation not found");
    error.status = 404;
    throw error;
  }

  return deleted;
}

async function restoreAdminDoc(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error("Invalid documentation id");
    error.status = 400;
    throw error;
  }

  const restored = await Documentation.findByIdAndUpdate(
    id,
    { isDeleted: false, deletedAt: null },
    { new: true },
  ).lean();

  if (!restored) {
    const error = new Error("Documentation not found");
    error.status = 404;
    throw error;
  }

  return mapDocumentationDoc(restored);
}

module.exports = {
  getPublishedDocs,
  getPublishedDocBySlug,
  getAdminDocs,
  getAdminDocById,
  createAdminDoc,
  updateAdminDoc,
  deleteAdminDoc,
  restoreAdminDoc,
  mapDocumentationDoc,
};
