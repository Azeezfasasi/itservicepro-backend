const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const productSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Product name is required'], 
    trim: true 
  },
  slug: { 
    type: String, 
    required: true, 
    unique: true 
  },
  description: { 
    type: String, 
    required: [true, 'Product description is required'] 
  },
  richDescription: { 
    type: String, 
    default: '' 
  },
  brand: { 
    type: String, 
    default: '' 
  },
  price: { 
    type: Number, 
    required: [true, 'Product price is required'],
    min: 0
  },
  originalPrice: { 
    type: Number, 
    min: 0 
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },
  subcategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  countInStock: { 
    type: Number, 
    required: true, 
    min: 0, 
    max: 999999 
  },
  images: [{ 
    type: String 
  }],
  featuredImage: { 
    type: String 
  },
  colors: [{ 
    type: String 
  }],
  sizes: [{ 
    type: String 
  }],
  tags: [{ 
    type: String 
  }],
  isFeatured: { 
    type: Boolean, 
    default: false 
  },
  isOnSale: { 
    type: Boolean, 
    default: false 
  },
  discountPercentage: { 
    type: Number, 
    min: 0, 
    max: 100 
  },
  reviews: [reviewSchema],
  rating: { 
    type: Number, 
    default: 0 
  },
  numReviews: { 
    type: Number, 
    default: 0 
  },
  sku: { 
    type: String 
  },
  weight: { 
    type: Number, 
    min: 0 
  },
  dimensions: {
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 }
  },
  shippingClass: { 
    type: String, 
    default: 'standard' 
  },
  taxClass: { 
    type: String, 
    default: 'standard' 
  },
  attributes: [{
    name: { type: String },
    value: { type: String }
  }],
  status: {
    type: String,
    required: true,
    enum: ['draft', 'published', 'archived'],
    default: 'draft'
  },
  variants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  isVariant: {
    type: Boolean,
    default: false
  },
  parentProduct: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  },
  variantAttributes: {
    type: Object
  },
  dateCreated: {
    type: Date,
    default: Date.now
  },
  dateModified: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Update the rating when a review is added or removed
productSchema.methods.updateRatingStats = function() {
  if (this.reviews.length === 0) {
    this.rating = 0;
    this.numReviews = 0;
  } else {
    this.numReviews = this.reviews.length;
    this.rating = this.reviews.reduce((acc, review) => review.rating + acc, 0) / this.reviews.length;
  }
  return this.save();
};

// Middleware to update dateModified on save
productSchema.pre('save', function(next) {
  this.dateModified = Date.now();
  next();
});

// Virtual for formatted price
productSchema.virtual('formattedPrice').get(function() {
  return `$${this.price.toFixed(2)}`;
});

// Virtual for sale price
productSchema.virtual('salePrice').get(function() {
  if (this.isOnSale && this.discountPercentage > 0) {
    return this.price * (1 - this.discountPercentage / 100);
  }
  return this.price;
});

// Index for search functionality
productSchema.index({ 
  name: 'text', 
  description: 'text', 
  brand: 'text',
  tags: 'text' 
});

module.exports = mongoose.model('Product', productSchema);