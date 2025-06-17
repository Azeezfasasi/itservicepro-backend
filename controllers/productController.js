const Product = require('../models/Product');
const Category = require('../models/Category'); // For category validation
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const slugify = require('slugify');
const cloudinary = require('../utils/cloudinary');

// --- Multer Setup for Product Images ---
const productStorage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadDir = 'public/uploads/products';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '-').toLowerCase()}`);
  }
});

const uploadImage = (imageBuffer, imageName) => {
  return cloudinary.uploader.upload(imageBuffer, {
    public_id: imageName,
    folder: 'products'
  });
};

const productFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Not an image! Please upload only images for products.'), false);
  }
};

// Middleware for handling multiple product image uploads
exports.uploadProductImages = multer({
  storage: productStorage,
  fileFilter: productFileFilter,
  limits: { fileSize: 1024 * 1024 * 10 }
}).array('images', 10); 

const uploadProductImages = async (req, res, next) => {
  try {
    if (!req.files || !req.files.images) {
      return next(new Error('No images provided'));
    }

    const images = req.files.images;
    const uploadedImages = [];

    for (const image of images) {
      const uploadedImage = await uploadImage(image.buffer, image.originalname);
      uploadedImages.push(uploadedImage.secure_url);
    }

    req.body.images = uploadedImages;
    next();
  } catch (error) {
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
    // Products with discountPercentage > 0 or onSale flag explicitly true
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
      // Clean up uploaded files if validation fails
      if (req.files && req.files.length > 0) {
        req.files.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
      return res.status(400).json({ error: 'Name, description, price, category, and stock quantity are required.' });
    }

    // Validate category exists
    const existingCategory = await Category.findById(category);
    if (!existingCategory) {
      if (req.files && req.files.length > 0) {
        req.files.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
      return res.status(400).json({ error: 'Invalid category ID.' });
    }

    // Prepare image URLs
    const imageUrls = req.files ? req.files.map(file => ({
      url: `/uploads/products/${file.filename}`,
      isFeatured: false, // Default to false, can be set later
    })) : [];

    // Set first image as featured by default if no other is specified
    if (imageUrls.length > 0) {
      imageUrls[0].isFeatured = true;
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
      images: imageUrls,
      thumbnail: imageUrls.length > 0 ? imageUrls[0].url : undefined, // Set thumbnail
    };

    const product = new Product(productData);
    await product.save();
    res.status(201).json(product);
  } catch (err) {
    // Clean up uploaded files if an error occurs during save
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        fs.unlinkSync(file.path);
      });
    }
    console.error('Error creating product:', err); // Log the error for debugging
    if (err.code === 11000 && err.keyPattern.slug) {
      return res.status(400).json({ error: 'Product name already exists, please choose a different name.' });
    }
    if (err.code === 11000 && err.keyPattern.sku) {
      return res.status(400).json({ error: 'SKU already exists, please use a unique SKU.' });
    }
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
      // Clean up newly uploaded files if product not found
      if (req.files && req.files.length > 0) {
        req.files.forEach(file => fs.unlinkSync(file.path));
      }
      return res.status(404).json({ error: 'Product not found' });
    }

    // Collect current image paths on the filesystem for later cleanup if they are removed
    const oldImagePathsOnDisk = product.images.map(img => path.join(__dirname, '../public', img.url));

    // Prepare updated image URLs
    let updatedImageUrls = [];
    if (existingImageUrls && Array.isArray(existingImageUrls)) {
      // Filter out images that are no longer in existingImageUrls (i.e., deleted by user)
      updatedImageUrls = product.images.filter(img =>
        existingImageUrls.includes(img.url)
      );
    }

    // Add newly uploaded images
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        updatedImageUrls.push({
          url: `/uploads/products/${file.filename}`,
          isFeatured: false, // Newly uploaded images are not featured by default
        });
      });
    }

    // Determine images to delete from disk (those in oldImagePathsOnDisk but not in updatedImageUrls)
    const imagesToDeleteFromDisk = oldImagePathsOnDisk.filter(oldPath => {
      const oldUrl = oldPath.replace(path.join(__dirname, '../public'), '').replace(/\\/g, '/'); // Normalize path for comparison
      return !updatedImageUrls.some(newImg => newImg.url === oldUrl);
    });

    // Delete old images from disk
    imagesToDeleteFromDisk.forEach(imgPath => {
      if (fs.existsSync(imgPath)) {
        fs.unlinkSync(imgPath);
      }
    });

    // Update product fields
    if (name !== undefined) product.name = name;
    if (description !== undefined) product.description = description;
    if (price !== undefined) product.price = parseFloat(price);
    if (category !== undefined) {
      const existingCategory = await Category.findById(category);
      if (!existingCategory) {
        // Clean up newly uploaded files if category is invalid
        if (req.files && req.files.length > 0) {
          req.files.forEach(file => fs.unlinkSync(file.path));
        }
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
    product.thumbnail = updatedImageUrls.length > 0 ? updatedImageUrls[0].url : '/placehold.co/400x400/CCCCCC/000000?text=No+Image'; // Update thumbnail

    // Re-save to trigger pre-save hooks (for slug, salePrice, onSale)
    await product.save();
    res.status(200).json(product);
  } catch (err) {
    // Clean up newly uploaded files if an error occurs during save
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => fs.unlinkSync(file.path));
    };
    console.error('Error updating product:', err); // Log the error for debugging
    if (err.code === 11000 && err.keyPattern.slug) {
      return res.status(400).json({ error: 'Product name already exists, please choose a different name.' });
    }
    if (err.code === 11000 && err.keyPattern.sku) {
      return res.status(400).json({ error: 'SKU already exists, please use a unique SKU.' });
    }
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

    // Delete associated images from the filesystem
    if (product.images && product.images.length > 0) {
      product.images.forEach(img => {
        const imagePath = path.join(__dirname, '../public', img.url);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      });
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
    const imagePath = path.join(__dirname, '../public', imageToDelete.url);

    // Remove from array
    product.images.splice(imageIndex, 1);

    // If the deleted image was the thumbnail, set a new one
    if (imageToDelete.url === product.thumbnail) {
      product.thumbnail = product.images.length > 0 ? product.images[0].url : '/placehold.co/400x400/CCCCCC/000000?text=No+Image';
    }

    // If there are no images left, revert thumbnail to default placeholder
    if (product.images.length === 0) {
      product.thumbnail = '/placehold.co/400x400/CCCCCC/000000?text=No+Image';
    }

    await product.save();

    // Delete image from filesystem
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

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
    product.thumbnail = product.images[imageIndex].url;

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
      // Optionally allow updating review, or return error
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