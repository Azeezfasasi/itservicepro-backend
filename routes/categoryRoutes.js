const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { auth, authorizeRoles } = require('../middleware/auth'); // Your authentication middleware

// Public routes
router.get('/', categoryController.getAllCategories);
router.get('/tree', categoryController.getCategoryTree); // Get categories in a hierarchical tree structure
router.get('/:id', categoryController.getCategoryById);
router.get('/slug/:slug', categoryController.getCategoryBySlug);

// Admin-only routes
router.post(
  '/',
  auth,
  authorizeRoles,
  categoryController.uploadCategoryImage, // Multer middleware for single image upload
  categoryController.createCategory
);
router.put(
  '/:id',
  auth,
  authorizeRoles,
  categoryController.uploadCategoryImage, // Multer middleware for single image upload
  categoryController.updateCategory
);
router.delete('/:id', auth, authorizeRoles, categoryController.deleteCategory);

module.exports = router;