const {
  getPublishedDocs: fetchPublishedDocs,
  getPublishedDocBySlug: fetchPublishedDocBySlug,
  getAdminDocs: fetchAdminDocs,
  getAdminDocById: fetchAdminDocById,
  createAdminDoc: createDocumentation,
  updateAdminDoc: updateDocumentation,
  deleteAdminDoc: deleteDocumentation,
} = require("../services/documentationService");

async function getPublishedDocs(req, res) {
  try {
    const docs = await fetchPublishedDocs();
    return res.status(200).json({
      success: true,
      docs,
    });
  } catch (error) {
    console.error("Error fetching public documentation:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch documentation",
      details: error.message,
    });
  }
}

async function getPublishedDocBySlug(req, res) {
  try {
    const { slug } = req.params;

    if (!slug || !slug.trim()) {
      return res.status(400).json({
        success: false,
        error: "slug is required",
      });
    }

    const doc = await fetchPublishedDocBySlug(slug);

    if (!doc) {
      return res.status(200).json({
        success: true,
        doc: null,
      });
    }

    return res.status(200).json({
      success: true,
      doc,
    });
  } catch (error) {
    console.error("Error fetching public documentation detail:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch documentation detail",
      details: error.message,
    });
  }
}

async function getAdminDocs(req, res) {
  try {
    const { docs, pagination } = await fetchAdminDocs(
      req.query.page,
      req.query.limit,
    );

    return res.status(200).json({
      success: true,
      docs,
      pagination,
    });
  } catch (error) {
    console.error("Error fetching admin documentation:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch admin documentation",
      details: error.message,
    });
  }
}

async function getAdminDocById(req, res) {
  try {
    const { id } = req.params;

    const doc = await fetchAdminDocById(id);

    return res.status(200).json({
      success: true,
      doc,
    });
  } catch (error) {
    console.error("Error fetching admin documentation detail:", error.message);
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        error: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      error: "Failed to fetch admin documentation detail",
      details: error.message,
    });
  }
}

async function createAdminDoc(req, res) {
  try {
    const doc = await createDocumentation(req.body);

    return res.status(201).json({
      success: true,
      doc,
    });
  } catch (error) {
    console.error("Error creating documentation:", error.message);
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        error: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      error: "Failed to create documentation",
      details: error.message,
    });
  }
}

async function updateAdminDoc(req, res) {
  try {
    const { id } = req.params;
    const updated = await updateDocumentation(id, req.body);

    return res.status(200).json({
      success: true,
      doc: updated,
    });
  } catch (error) {
    console.error("Error updating documentation:", error.message);
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        error: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      error: "Failed to update documentation",
      details: error.message,
    });
  }
}

async function deleteAdminDoc(req, res) {
  try {
    const { id } = req.params;

    await deleteDocumentation(id);

    return res.status(200).json({
      success: true,
      message: "Documentation deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting documentation:", error.message);
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        error: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      error: "Failed to delete documentation",
      details: error.message,
    });
  }
}

module.exports = {
  getPublishedDocs,
  getPublishedDocBySlug,
  getAdminDocs,
  getAdminDocById,
  createAdminDoc,
  updateAdminDoc,
  deleteAdminDoc,
};
