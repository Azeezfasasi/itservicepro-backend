const Product = require('../models/Product');
const Category = require('../models/Category'); // For category validation
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const slugify = require('slugify');
const cloudinary = require('../utils/cloudinary');
  
  // --- Multer Setup for Product Images ---
  const memoryStorage = multer.memoryStorage();
  
  const productFileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
cb(null, true);
  } else {
    cb(new Error('Not an image! Please upload only images for products.'), false);
  }
  };
  
  // Middleware for handling multiple product image uploads
  exports.uploadMiddlewareMemory = multer({
    storage: memoryStorage, // Use memoryStorage
fileFilter: productFileFilter,
  limits: { fileSize: 1024 * 1024 * 10 }
}).array('images', 10);

// Define the async image processing middleware separately
exports.processUploadedImages = async (req, res, next) => {
  try {
    // If no files uploaded, move on
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      req.body.images = [];
      return next();
    }

    const uploadedImages = [];
  
      for (const image of req.files) {
        const uploadedImage = await cloudinary.uploader.upload(image.buffer, {
          folder: 'products'
        });
        uploadedImages.push(uploadedImage.secure_url);
      }
  
req.body.images = uploadedImages;
    next();
  } catch (error) {
    console.error('Error processing uploaded images:', error);
    next(error);
  }
};

// Get all products
exports.getAllProducts = async (req, res) => {
  try {
    const { category, brand, minPrice, maxPrice, status, sortBy, search, page = 1, limit = 10 } = req.query;
    const query = {};

    if (category) {
      // Find category by slug or ID
      const categoryDoc = await Category.findOne({ $or: [{ _id: category }, { slug: category }] });
      if (categoryDoc) {
        query.category = categoryDoc._id;
      } else {
        return res.status(404).json({ error: 'Category not found' });
      }
    }
    if (brand) query.brand = new RegExp(brand, 'i'); // Case-insensitive brand search
    if (status) query.status = status;

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
      ];
    }

    const sortOptions = {};
    if (sortBy === 'priceAsc') sortOptions.price = 1;
    else if (sortBy === 'priceDesc') sortOptions.price = -1;
    else if (sortBy === 'nameAsc') sortOptions.name = 1;
    else if (sortBy === 'nameDesc') sortOptions.name = -1;
    else if (sortBy === 'newest') sortOptions.createdAt = -1;
    else if (sortBy === 'oldest') sortOptions.createdAt = 1;
    else if (sortBy === 'rating') sortOptions.rating = -1;
    else sortOptions.createdAt = -1; // Default sort by newest

    const products = await Product.find(query)
      .sort(sortOptions)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const totalProducts = await Product.countDocuments(query);
    const totalPages = Math.ceil(totalProducts / limit);

    res.status(200).json({
      data: products,
      totalProducts,
      totalPages,
      currentPage: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch products',
      details: err.message,
    });
  }
};

// Get product by ID
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json(product);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch product',
      details: err.message,
    });
  }
};

// Get product by slug
exports.getProductBySlug = async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug });
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json(product);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch product',
      details: err.message,
    });
  }
};

// Get featured products
exports.getFeaturedProducts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    const featuredProducts = await Product.find({ isFeatured: true, status: 'active' }).limit(limit);
    res.status(200).json(featuredProducts);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch featured products',
      details: err.message,
    });
  }
};

// Get sale products
exports.getSaleProducts = async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 8;
      const saleProducts = await Product.find({ $or: [{ onSale: true }, { discountPercentage: { $gt: 0 } }], status: 'active' }).limit(limit);
      res.status(200).json(saleProducts);
    } catch (err) {
res.status(500).json({
      error: 'Failed to fetch sale products',
      details: err.message,
    });
  }
};

// Create new product (Admin Only)
exports.createProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      category,
      brand,
      sku,
      stockQuantity,
      isFeatured,
      discountPercentage,
      status
    } = req.body;
      // Validate required fields
      if (!name || !description || !price || !category || !stockQuantity) {
        return res.status(400).json({ error: 'Name, description, price, category, and stock quantity are required.' });
      }
  
// Validate category exists
      const existingCategory = await Category.findById(category);
      if (!existingCategory) {
        return res.status(400).json({ error: 'Invalid category ID.' });
      }
      const productData = {
        name,
        description,
        price: parseFloat(price),
        category,
        brand,
        sku,
        stockQuantity: parseInt(stockQuantity),
        isFeatured: Boolean(isFeatured),
        discountPercentage: discountPercentage ? parseFloat(discountPercentage) : 0,
        status: status || 'draft',
        images: req.body.images || [], // Use Cloudinary URLs
        thumbnail: req.body.images && req.body.images.length > 0 ? req.body.images[0] : undefined, // Set thumbnail
      };
  
      const product = new Product(productData);
await product.save();
      res.status(201).json(product);
    } catch (err) {
      console.error('Error creating product:', err); // Log the error for debugging
      res.status(500).json({
        error: 'Failed to create product',
        details: err.message,
});
  }
};


// Update product (Admin Only)
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      price,
      category,
      brand,
      sku,
      stockQuantity,
      isFeatured,
      discountPercentage,
      status,
      existingImageUrls // Array of existing image URLs from frontend
    } = req.body;
      const product = await Product.findById(id);
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      // Prepare updated image URLs
      let updatedImageUrls = [...(existingImageUrls || [])];
  
      // Add newly uploaded images
      if (req.body.images && Array.isArray(req.body.images)) {
        updatedImageUrls = updatedImageUrls.concat(req.body.images);
      }
  
      // Update product fields
      if (name !== undefined) product.name = name;
if (description !== undefined) product.description = description;
    if (price !== undefined) product.price = parseFloat(price);
    if (category !== undefined) {
        const existingCategory = await Category.findById(category);
        if (!existingCategory) {
          return res.status(400).json({ error: 'Invalid category ID.' });
        }
        product.category = category;
}
    if (brand !== undefined) product.brand = brand;
    if (sku !== undefined) product.sku = sku;
    if (stockQuantity !== undefined) product.stockQuantity = parseInt(stockQuantity);
    if (isFeatured !== undefined) product.isFeatured = Boolean(isFeatured);
    if (discountPercentage !== undefined) product.discountPercentage = parseFloat(discountPercentage);
    if (status !== undefined) product.status = status;
  
      product.images = updatedImageUrls;
      product.thumbnail = updatedImageUrls.length > 0 ? updatedImageUrls[0] : '/placehold.co/400x400/CCCCCC/000000?text=No+Image'; // Update thumbnail
  
      // Re-save to trigger pre-save hooks (for slug, salePrice, onSale)
      await product.save();
      res.status(200).json(product);
    } catch (err) {
      console.error('Error updating product:', err); // Log the error for debugging
      res.status(500).json({
        error: 'Failed to update product',
        details: err.message,
});
  }
};


// Delete product (Admin Only)
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
      }
  
      await Product.findByIdAndDelete(id);
      res.status(200).json({ message: 'Product deleted successfully' });
} catch (err) {
    res.status(500).json({
      error: 'Failed to delete product',
      details: err.message,
    });
  }
};

// Delete a specific product image (Admin Only)
exports.deleteProductImage = async (req, res) => {
  try {
    const { id, imageIndex } = req.params; // id is product ID
    const product = await Product.findById(id);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    if (imageIndex < 0 || imageIndex >= product.images.length) {
      return res.status(400).json({ error: 'Invalid image index' });
    }
  
      const imageToDelete = product.images[imageIndex];
  
      // Remove from array
      product.images.splice(imageIndex, 1);
  
      // If the deleted image was the thumbnail, set a new one
      if (imageToDelete === product.thumbnail) {
        product.thumbnail = product.images.length > 0 ? product.images[0] : '/placehold.co/400x400/CCCCCC/000000?text=No+Image';
      }
  
      // If there are no images left, revert thumbnail to default placeholder
if (product.images.length === 0) {
      product.thumbnail = '/placehold.co/400x400/CCCCCC/000000?text=No+Image';
    }
      await product.save();
  
      res.status(200).json({ message: 'Image deleted successfully', product });
    } catch (err) {
res.status(500).json({
      error: 'Failed to delete image',
      details: err.message,
    });
  }
};

// Set featured image (Admin Only)
exports.setFeaturedImage = async (req, res) => {
  try {
    const { id } = req.params; // Product ID
    const { imageIndex } = req.body;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (imageIndex === undefined || imageIndex < 0 || imageIndex >= product.images.length) {
      return res.status(400).json({ error: 'Invalid image index provided.' });
    }

    // Reset all images to not featured
    product.images.forEach(img => (img.isFeatured = false));

    // Set the selected image as featured
    product.images[imageIndex].isFeatured = true;
  
      // Also update the main thumbnail for consistency
      product.thumbnail = product.images[imageIndex];
  
      await product.save();
      res.status(200).json({ message: 'Featured image updated successfully', product });
} catch (err) {
    res.status(500).json({
      error: 'Failed to set featured image',
      details: err.message,
    });
  }
};

// Update product inventory (Admin Only)
exports.updateInventory = async (req, res) => {
  try {
    const { id } = req.params; // Product ID
    const { quantity } = req.body;

    if (quantity === undefined || isNaN(quantity) || quantity < 0) {
      return res.status(400).json({ error: 'Valid positive quantity is required.' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    product.stockQuantity = parseInt(quantity);
    await product.save();

    res.status(200).json({ message: 'Inventory updated successfully', product });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to update inventory',
      details: err.message,
    });
  }
};

// Bulk update product status (Admin Only)
exports.bulkUpdateStatus = async (req, res) => {
  try {
    const { productIds, status } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0 || !status) {
      return res.status(400).json({ error: 'Product IDs and status are required.' });
    }
    if (!['active', 'inactive', 'draft'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status provided. Must be active, inactive, or draft.' });
    }

    const result = await Product.updateMany(
      { _id: { $in: productIds } },
      { $set: { status: status } }
    );

    res.status(200).json({
      message: `${result.modifiedCount} products updated successfully to status: ${status}`,
      updatedCount: result.modifiedCount,
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to bulk update product status',
      details: err.message,
    });
  }
};

// Add product review
exports.addProductReview = async (req, res) => {
  try {
    const { id } = req.params; // Product ID
    const { rating, comment } = req.body;
    const { _id: userId, name: userName } = req.user; // From auth middleware

    if (!rating || !comment) {
      return res.status(400).json({ error: 'Rating and comment are required.' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    // Check if user has already reviewed this product
    const alreadyReviewed = product.reviews.find(
      (r) => r.user.toString() === userId.toString()
    );
  
      if (alreadyReviewed) {
        alreadyReviewed.rating = rating;
        alreadyReviewed.comment = comment;
        alreadyReviewed.timestamps = { updatedAt: new Date() }; // Manually update timestamp
res.status(200).json({ message: 'Review updated successfully', product });
    } else {
      const review = {
        user: userId,
        name: userName,
        rating: Number(rating),
        comment,
      };
      product.reviews.push(review);
      res.status(201).json({ message: 'Review added successfully', product });
    }

    // Update average rating and number of reviews
    product.updateAverageRating();
    await product.save();

  } catch (err) {
    res.status(500).json({
      error: 'Failed to add review',
      details: err.message,
    });
  }
};