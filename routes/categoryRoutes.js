const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { auth, authorizeRoles } = require('../middleware/auth');

// Public routes
// GET /api/categories
router.get('/', categoryController.getAllCategories);

// GET /api/categories/tree
router.get('/tree', categoryController.getCategoryTree);

// GET /api/categories/:id
router.get('/:id', categoryController.getCategoryById);

// GET /api/categories/slug/:slug
router.get('/slug/:slug', categoryController.getCategoryBySlug);

// Admin only routes - require authentication and authorization
router.use(auth);
router.use(authorizeRoles(['admin', 'super admin']));

// POST /api/categories
router.post('/', 
  categoryController.uploadCategoryImage,
  categoryController.createCategory
);

// PUT /api/categories/:id
router.put('/:id', 
  categoryController.uploadCategoryImage,
  categoryController.updateCategory
);

// DELETE /api/categories/:id
router.delete('/:id', categoryController.deleteCategory);

module.exports = router;