// // models/Product.js
const mongoose = require('mongoose');
const slugify = require('slugify');

const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  comment: {
    type: String,
    required: true,
  },
}, {
  timestamps: true,
});

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [100, 'Product name cannot exceed 100 characters'],
  },
  slug: {
    type: String,
    unique: true, // This automatically creates a unique index
  },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    maxlength: [1000, 'Product description cannot exceed 1000 characters'],
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative'],
  },
  salePrice: {
    type: Number,
    min: [0, 'Sale price cannot be negative'],
    default: function() {
      return this.price; // Default to regular price if not set
    }
  },
  discountPercentage: {
    type: Number,
    min: [0, 'Discount percentage cannot be negative'],
    max: [100, 'Discount percentage cannot exceed 100'],
    default: 0,
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Product must belong to a category'],
  },
  brand: {
    type: String,
    trim: true,
    maxlength: [50, 'Brand name cannot exceed 50 characters'],
  },
  sku: { // Stock Keeping Unit
    type: String,
    unique: true,
    trim: true,
    uppercase: true,
  },
  stockQuantity: {
    type: Number,
    required: [true, 'Stock quantity is required'],
    min: [0, 'Stock quantity cannot be negative'],
    default: 0,
  },
  images: [
    {
      url: {
        type: String,
        required: true,
      },
      isFeatured: {
        type: Boolean,
        default: false,
      },
    },
  ],
  thumbnail: { // A single thumbnail URL for quick display
    type: String,
    default: '/placehold.co/400x400/CCCCCC/000000?text=No+Image'
  },
  isFeatured: {
    type: Boolean,
    default: false,
  },
  onSale: {
    type: Boolean,
    default: false,
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
    set: (val) => parseFloat(val.toFixed(1)), // Ensure one decimal place
  },
  numReviews: {
    type: Number,
    default: 0,
  },
  reviews: [reviewSchema],
  status: {
    type: String,
    enum: ['active', 'inactive', 'draft'],
    default: 'draft',
  },
}, {
  timestamps: true,
});

// Pre-save hook to generate slug and calculate sale price/onSale
productSchema.pre('save', function(next) {
  // Generate slug from name
  if (this.isModified('name') && this.name) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }

  // Calculate salePrice if discountPercentage is provided
  if (this.isModified('price') || this.isModified('discountPercentage')) {
    if (this.discountPercentage > 0) {
      this.salePrice = this.price * (1 - this.discountPercentage / 100);
      this.onSale = true;
    } else {
      this.salePrice = this.price;
      this.onSale = false;
    }
  }

  // Set thumbnail from first image if available and no thumbnail is explicitly set
  if (this.isModified('images') && this.images && this.images.length > 0 && !this.thumbnail) {
    this.thumbnail = this.images[0].url;
  }

  next();
});

// Pre-find hook to populate category
productSchema.pre(/^find/, function(next) {
  this.populate({
    path: 'category',
    select: 'name slug image', // Select only necessary fields
  });
  next();
});

// Method to update average rating and number of reviews
productSchema.methods.updateAverageRating = function() {
  const numReviews = this.reviews.length;
  if (numReviews === 0) {
    this.rating = 0;
  } else {
    const totalRating = this.reviews.reduce((acc, review) => acc + review.rating, 0);
    this.rating = totalRating / numReviews;
  }
  this.numReviews = numReviews;
};

// Index for search optimization
productSchema.index({ name: 'text', description: 'text', brand: 'text' });
productSchema.index({ category: 1, status: 1 });
productSchema.index({ price: 1, salePrice: 1 });
// REMOVED: productSchema.index({ slug: 1 }); // Duplicate: unique: true already handles this

const Product = mongoose.model('Product', productSchema);

module.exports = Product;