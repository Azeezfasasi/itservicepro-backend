const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const { auth, authorizeRoles } = require('../middleware/auth');
const { upload } = require('../utils/cloudinary');

// Public Routes
// GET /api/projects - Get all projects
router.get('/', projectController.getAllProjects);

// GET /api/projects/:id - Get single project by ID
router.get('/:id', projectController.getProjectById);

// Admin/Super Admin Routes (Requires authentication and authorization)
// POST /api/projects - Create a new project (with image upload)
// 'images' is the field name in your form data that holds the files
router.post('/', auth, authorizeRoles, upload.array('images', 10), projectController.createProject
);

// PUT /api/projects/:id - Update an existing project (with potential new image uploads)
// Use a different field name for new images during update
router.put('/:id', auth, authorizeRoles, upload.array('newImages', 10), projectController.updateProject
);

// DELETE /api/projects/:id - Delete a project
router.delete('/:id', auth, authorizeRoles, projectController.deleteProject
);

module.exports = router;
