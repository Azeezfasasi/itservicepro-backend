const express = require('express');
const router = express.Router();
const { 
     getAllCategories,
     getCategoryTree, 
     getCategoryById, 
     getCategoryBySlug, 
     createCategory, 
     updateCategory, 
     deleteCategory } = require('../controllers/categoryController');
const { auth, authorizeRoles } = require('../middleware/auth');

// Public routes
// GET /api/categories
router.get('/', getAllCategories);

// GET /api/categories/tree
router.get('/tree', getCategoryTree);

// GET /api/categories/:id
router.get('/:id', getCategoryById);

// GET /api/categories/slug/:slug
router.get('/slug/:slug', getCategoryBySlug);

// Admin only routes - require authentication and authorization

// POST /api/categories
router.post('/', auth, authorizeRoles, createCategory);

// PUT /api/categories/:id
router.put('/:id', auth, authorizeRoles, updateCategory);

// DELETE /api/categories/:id
router.delete('/:id', auth, authorizeRoles, deleteCategory);

module.exports = router;