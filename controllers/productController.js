const Product = require('../models/Product');
const Category = require('../models/Category');
const slugify = require('slugify');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadDir = 'public/uploads/products';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    cb(null, `${Date.now()}-${slugify(file.originalname, { lower: true })}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Not an image! Please upload only images.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

exports.uploadProductImages = upload.array('images', 10);

// Create a new product
exports.createProduct = async (req, res) => {
  try {
    // Generate slug from product name
    const slug = slugify(req.body.name, { lower: true });
    
    // Process uploaded images
    let uploadedFiles = [];
    let featuredImage = '';
    
    if (req.files && req.files.length > 0) {
      uploadedFiles = req.files.map(file => `/uploads/products/${file.filename}`);
      featuredImage = uploadedFiles[0]; // First image is featured by default
    }
    
    // Check if category exists
    const categoryExists = await Category.findById(req.body.category);
    if (!categoryExists) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    
    // Create new product object
    const productData = {
      ...req.body,
      slug,
      images: uploadedFiles,
      featuredImage
    };
    
    // Handle price and stock as numbers
    if (req.body.price) productData.price = Number(req.body.price);
    if (req.body.originalPrice) productData.originalPrice = Number(req.body.originalPrice);
    if (req.body.countInStock) productData.countInStock = Number(req.body.countInStock);
    if (req.body.discountPercentage) productData.discountPercentage = Number(req.body.discountPercentage);
    
    // Handle arrays that might come as strings
    if (req.body.colors && typeof req.body.colors === 'string') {
      productData.colors = req.body.colors.split(',').map(color => color.trim());
    }
    
    if (req.body.sizes && typeof req.body.sizes === 'string') {
      productData.sizes = req.body.sizes.split(',').map(size => size.trim());
    }
    
    if (req.body.tags && typeof req.body.tags === 'string') {
      productData.tags = req.body.tags.split(',').map(tag => tag.trim());
    }
    
    // Convert boolean strings to actual booleans
    if (req.body.isFeatured) {
      productData.isFeatured = req.body.isFeatured === 'true';
    }
    
    if (req.body.isOnSale) {
      productData.isOnSale = req.body.isOnSale === 'true';
    }
    
    // Create the product
    const product = new Product(productData);
    await product.save();
    
    res.status(201).json(product);
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ 
      error: 'Failed to create product', 
      details: err.message 
    });
  }
};

// Get all products with filtering, sorting, and pagination
exports.getAllProducts = async (req, res) => {
  try {
    // FILTERING
    const queryObj = { ...req.query };
    const excludedFields = ['page', 'sort', 'limit', 'fields', 'search'];
    excludedFields.forEach(field => delete queryObj[field]);
    
    // Advanced filtering (for range queries like price[gte]=10)
    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, match => `$${match}`);
    
    // Base query
    let query = Product.find(JSON.parse(queryStr)).populate('category');
    
    // Search functionality
    if (req.query.search) {
      query = query.find({ $text: { $search: req.query.search } });
    }
    
    // Filter by category slug
    if (req.query.categorySlug) {
      const category = await Category.findOne({ slug: req.query.categorySlug });
      if (category) {
        query = query.find({ category: category._id });
      }
    }
    
    // SORTING
    if (req.query.sort) {
      const sortBy = req.query.sort.split(',').join(' ');
      query = query.sort(sortBy);
    } else {
      query = query.sort('-dateCreated'); // Default sort by newest
    }
    
    // FIELD LIMITING
    if (req.query.fields) {
      const fields = req.query.fields.split(',').join(' ');
      query = query.select(fields);
    }
    
    // PAGINATION
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;
    
    query = query.skip(skip).limit(limit);
    
    // Execute query
    const products = await query;
    
    // Get total count for pagination
    const totalProducts = await Product.countDocuments(JSON.parse(queryStr));
    
    res.status(200).json({
      totalProducts,
      totalPages: Math.ceil(totalProducts / limit),
      currentPage: page,
      results: products.length,
      data: products
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ 
      error: 'Failed to fetch products', 
      details: err.message 
    });
  }
};

// Get product by ID
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('category')
      .populate('subcategories')
      .populate({
        path: 'reviews.user',
        select: 'name email'
      });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.status(200).json(product);
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).json({ 
      error: 'Failed to fetch product', 
      details: err.message 
    });
  }
};

// Get product by slug
exports.getProductBySlug = async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug })
      .populate('category')
      .populate('subcategories')
      .populate({
        path: 'reviews.user',
        select: 'name email'
      });
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.status(200).json(product);
  } catch (err) {
    console.error('Error fetching product by slug:', err);
    res.status(500).json({ 
      error: 'Failed to fetch product', 
      details: err.message 
    });
  }
};

// Update product
exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Process uploaded images if any
    let uploadedFiles = [];
    
    if (req.files && req.files.length > 0) {
      uploadedFiles = req.files.map(file => `/uploads/products/${file.filename}`);
      
      // Add new images to existing ones
      product.images = [...product.images, ...uploadedFiles];
      
      // If no featured image set or explicitly requested, set first new image as featured
      if (!product.featuredImage || req.body.setFeaturedFromNew === 'true') {
        product.featuredImage = uploadedFiles[0];
      }
    }
    
    // Update slug if name is changing
    if (req.body.name && req.body.name !== product.name) {
      req.body.slug = slugify(req.body.name, { lower: true });
    }
    
    // Handle arrays that might come as strings
    if (req.body.colors && typeof req.body.colors === 'string') {
      req.body.colors = req.body.colors.split(',').map(color => color.trim());
    }
    
    if (req.body.sizes && typeof req.body.sizes === 'string') {
      req.body.sizes = req.body.sizes.split(',').map(size => size.trim());
    }
    
    if (req.body.tags && typeof req.body.tags === 'string') {
      req.body.tags = req.body.tags.split(',').map(tag => tag.trim());
    }
    
    // Convert string numbers to actual numbers
    if (req.body.price) req.body.price = Number(req.body.price);
    if (req.body.originalPrice) req.body.originalPrice = Number(req.body.originalPrice);
    if (req.body.countInStock) req.body.countInStock = Number(req.body.countInStock);
    if (req.body.discountPercentage) req.body.discountPercentage = Number(req.body.discountPercentage);
    
    // Convert boolean strings to actual booleans
    if (req.body.isFeatured !== undefined) {
      req.body.isFeatured = req.body.isFeatured === 'true';
    }
    
    if (req.body.isOnSale !== undefined) {
      req.body.isOnSale = req.body.isOnSale === 'true';
    }
    
    // Update the product
    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      { ...req.body, dateModified: Date.now() },
      { new: true, runValidators: true }
    ).populate('category');
    
    res.status(200).json(updatedProduct);
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ 
      error: 'Failed to update product', 
      details: err.message 
    });
  }
};

// Delete product
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Delete associated images from file system
    if (product.images && product.images.length > 0) {
      product.images.forEach(image => {
        const imagePath = path.join(__dirname, '../public', image);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      });
    }
    
    await Product.findByIdAndDelete(req.params.id);
    
    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ 
      error: 'Failed to delete product', 
      details: err.message 
    });
  }
};

// Delete product image
exports.deleteProductImage = async (req, res) => {
  try {
    const { id, imageIndex } = req.params;
    const product = await Product.findById(id);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    if (!product.images || imageIndex >= product.images.length) {
      return res.status(400).json({ error: 'Image not found' });
    }
    
    // Get the image path
    const imageToDelete = product.images[imageIndex];
    
    // Remove from array
    product.images.splice(imageIndex, 1);
    
    // If deleted image was the featured image, set a new one if available
    if (product.featuredImage === imageToDelete && product.images.length > 0) {
      product.featuredImage = product.images[0];
    } else if (product.images.length === 0) {
      product.featuredImage = '';
    }
    
    await product.save();
    
    // Delete the file from the file system
    const imagePath = path.join(__dirname, '../public', imageToDelete);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    
    res.status(200).json({ 
      message: 'Image deleted successfully',
      product
    });
  } catch (err) {
    console.error('Error deleting product image:', err);
    res.status(500).json({ 
      error: 'Failed to delete product image', 
      details: err.message 
    });
  }
};

// Set featured image
exports.setFeaturedImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { imageIndex } = req.body;
    
    const product = await Product.findById(id);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    if (!product.images || imageIndex >= product.images.length) {
      return res.status(400).json({ error: 'Image not found' });
    }
    
    product.featuredImage = product.images[imageIndex];
    await product.save();
    
    res.status(200).json({ 
      message: 'Featured image updated',
      product
    });
  } catch (err) {
    console.error('Error setting featured image:', err);
    res.status(500).json({ 
      error: 'Failed to set featured image', 
      details: err.message 
    });
  }
};

// Get featured products
exports.getFeaturedProducts = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 8;
    
    const products = await Product.find({ isFeatured: true, status: 'published' })
      .limit(limit)
      .populate('category');
    
    res.status(200).json(products);
  } catch (err) {
    console.error('Error fetching featured products:', err);
    res.status(500).json({ 
      error: 'Failed to fetch featured products', 
      details: err.message 
    });
  }
};

// Get on sale products
exports.getOnSaleProducts = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 8;
    
    const products = await Product.find({ isOnSale: true, status: 'published' })
      .limit(limit)
      .populate('category');
    
    res.status(200).json(products);
  } catch (err) {
    console.error('Error fetching sale products:', err);
    res.status(500).json({ 
      error: 'Failed to fetch sale products', 
      details: err.message 
    });
  }
};

// Get product count
exports.getProductCount = async (req, res) => {
  try {
    const productCount = await Product.countDocuments();
    
    res.status(200).json({ count: productCount });
  } catch (err) {
    console.error('Error counting products:', err);
    res.status(500).json({ 
      error: 'Failed to count products', 
      details: err.message 
    });
  }
};

// Add a product review
exports.addProductReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    
    if (!rating || !comment) {
      return res.status(400).json({ error: 'Rating and comment are required' });
    }
    
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Check if user already reviewed this product
    const alreadyReviewed = product.reviews.find(
      review => review.user.toString() === req.user.id
    );
    
    if (alreadyReviewed) {
      return res.status(400).json({ error: 'Product already reviewed' });
    }
    
    // Create new review
    const review = {
      user: req.user.id,
      name: req.user.name,
      rating: Number(rating),
      comment
    };
    
    // Add to reviews array
    product.reviews.push(review);
    
    // Update product rating statistics
    await product.updateRatingStats();
    
    res.status(201).json({ 
      message: 'Review added',
      product
    });
  } catch (err) {
    console.error('Error adding review:', err);
    res.status(500).json({ 
      error: 'Failed to add review', 
      details: err.message 
    });
  }
};

// Update product inventory
exports.updateInventory = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;
    
    if (quantity === undefined) {
      return res.status(400).json({ error: 'Quantity is required' });
    }
    
    const product = await Product.findById(id);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Update inventory
    product.countInStock = Math.max(0, parseInt(quantity));
    await product.save();
    
    res.status(200).json({
      message: 'Inventory updated',
      product
    });
  } catch (err) {
    console.error('Error updating inventory:', err);
    res.status(500).json({ 
      error: 'Failed to update inventory', 
      details: err.message 
    });
  }
};

// Bulk update product statuses
exports.bulkUpdateStatus = async (req, res) => {
  try {
    const { productIds, status } = req.body;
    
    if (!productIds || !Array.isArray(productIds) || !status) {
      return res.status(400).json({ error: 'Product IDs array and status are required' });
    }
    
    if (!['draft', 'published', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await Product.updateMany(
      { _id: { $in: productIds } },
      { status, dateModified: Date.now() }
    );
    
    res.status(200).json({ message: `${productIds.length} products updated to ${status}` });
  } catch (err) {
    console.error('Error bulk updating products:', err);
    res.status(500).json({ 
      error: 'Failed to update products', 
      details: err.message 
    });
  }
};