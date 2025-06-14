const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { auth, authorizeRoles } = require('../middleware/auth');

// Public routes
// GET /api/products
router.get('/', productController.getAllProducts);

// GET /api/products/count
router.get('/count', productController.getProductCount);

// GET /api/products/featured
router.get('/featured', productController.getFeaturedProducts);

// GET /api/products/sale
router.get('/sale', productController.getOnSaleProducts);

// GET /api/products/:id
router.get('/:id', productController.getProductById);

// GET /api/products/slug/:slug
router.get('/slug/:slug', productController.getProductBySlug);

// POST /api/products/:id/reviews
router.post('/:id/reviews',auth, authorizeRoles, productController.addProductReview);

// POST /api/products
router.post('/',auth, authorizeRoles, 
  productController.uploadProductImages,
  productController.createProduct
);

// PUT /api/products/:id
router.put('/:id',auth, authorizeRoles, 
  productController.uploadProductImages,
  productController.updateProduct
);

// DELETE /api/products/:id
router.delete('/:id',auth, authorizeRoles, productController.deleteProduct);

// DELETE /api/products/:id/images/:imageIndex
router.delete('/:id/images/:imageIndex',auth, authorizeRoles, productController.deleteProductImage);

// PUT /api/products/:id/featured-image
router.put('/:id/featured-image',auth, authorizeRoles, productController.setFeaturedImage);

// PUT /api/products/:id/inventory
router.put('/:id/inventory',auth, authorizeRoles, productController.updateInventory);

// POST /api/products/bulk/status
router.post('/bulk/status',auth, authorizeRoles, productController.bulkUpdateStatus);

module.exports = router;