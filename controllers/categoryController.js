const Category = require('../models/Category');
const Product = require('../models/Product');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const slugify = require('slugify');

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadDir = 'public/uploads/categories';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    // Sanitize filename for URL-friendliness and prevent issues
    const sanitizedOriginalname = file.originalname.replace(/\s+/g, '-').toLowerCase().replace(/[^a-z0-9-.]/g, '');
    cb(null, `${Date.now()}-${sanitizedOriginalname}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    // Pass an error if the file is not an image
    cb(new Error('Not an image! Please upload only images.'), false);
  }
};

exports.uploadCategoryImage = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 1024 * 1024 * 5 } // 5MB limit
}).single('image');

// Get all categories
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find().sort({ sortOrder: 1, name: 1 });
    res.status(200).json(categories);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch categories',
      details: err.message
    });
  }
};

// Get category by ID
exports.getCategoryById = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id)
      .populate('parent')
      .populate('subcategories'); // Populate virtual subcategories
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.status(200).json(category);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch category',
      details: err.message
    });
  }
};

// Get category by slug
exports.getCategoryBySlug = async (req, res) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug })
      .populate('parent')
      .populate('subcategories'); // Populate virtual subcategories
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.status(200).json(category);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch category by slug',
      details: err.message
    });
  }
};

// Create new category (Admin Only)
exports.createCategory = async (req, res) => {
  try {
    const { name, description, parent, isActive, sortOrder } = req.body;

    // Validate required fields
    if (!name || name.trim() === '') {
      // If a file was uploaded, delete it because of validation error
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Category name is required' });
    }

    // Check if category with same name already exists
    const existingCategory = await Category.findOne({ name: { $regex: new RegExp(`^${name.trim()}$`, 'i') } });
    if (existingCategory) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: `Category with name '${name}' already exists.` });
    }

    let imagePath = '';
    if (req.file) {
      imagePath = `/uploads/categories/${req.file.filename}`;
    }

    // Create new category object
    const categoryData = {
      name: name.trim(),
      description: description || '',
      image: imagePath,
      isActive: isActive === 'false' ? false : Boolean(isActive), // Handle 'false' string from FormData
      sortOrder: sortOrder ? Number(sortOrder) : 0,
    };

    // Add parent if provided and valid
    if (parent) {
      const parentCategory = await Category.findById(parent);
      if (!parentCategory) {
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ error: 'Parent category not found.' });
      }
      categoryData.parent = parent;
      // Level will be set by pre-save hook
    }

    const category = new Category(categoryData);
    await category.save(); // Pre-save hook will handle slug and level

    res.status(201).json(category);
  } catch (err) {
    // If a file was uploaded and an error occurred during DB save, delete the file
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error creating category:', err); // Log for debugging
    // Handle specific unique key errors (e.g., slug, name)
    if (err.code === 11000 && err.keyPattern.slug) {
        return res.status(400).json({ error: 'Generated slug already exists. Please modify category name.' });
    }
    if (err.code === 11000 && err.keyPattern.name) {
        return res.status(400).json({ error: 'Category name already exists.' });
    }
    // Handle custom errors from pre-save hooks (e.g., parent not found)
    if (err.statusCode === 400) {
        return res.status(400).json({ error: err.message });
    }
    res.status(500).json({
      error: 'Failed to create category',
      details: err.message
    });
  }
};

// Update category (Admin Only)
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, parent, isActive, sortOrder } = req.body;

    const category = await Category.findById(id);
    if (!category) {
      // If a file was newly uploaded and category not found, delete the file
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check for circular reference: a category cannot be its own parent
    if (parent && parent === id) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'A category cannot be its own parent.' });
    }

    // Process uploaded image if any
    if (req.file) {
      // Delete old image if it exists and is not the default placeholder
      if (category.image && !category.image.includes('placehold.co')) {
        const oldImagePath = path.join(__dirname, '../public', category.image);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
      category.image = `/uploads/categories/${req.file.filename}`;
    } else if (req.body.image === '') { // Explicitly indicate image removal from frontend
      if (category.image && !category.image.includes('placehold.co')) {
        const oldImagePath = path.join(__dirname, '../public', category.image);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
      category.image = '/placehold.co/400x400/CCCCCC/000000?text=No+Image'; // Set to default placeholder
    }


    // Update category fields based on what's provided in req.body
    if (name !== undefined) category.name = name.trim();
    if (description !== undefined) category.description = description;
    if (isActive !== undefined) category.isActive = isActive === 'false' ? false : Boolean(isActive); // Handle 'false' string
    if (sortOrder !== undefined) category.sortOrder = Number(sortOrder);

    // Handle parent change
    if (parent !== undefined) {
      if (!parent) { // Parent explicitly set to empty (top level)
        category.parent = null;
        category.level = 0; // Level will be set by pre-save hook anyway, but explicit for clarity
      } else { // Parent provided
        const parentCategory = await Category.findById(parent);
        if (!parentCategory) {
          if (req.file) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({ error: 'Parent category not found.' });
        }
        category.parent = parent;
        // Level will be updated by the pre-save hook based on new parent
      }
    }

    await category.save(); // Trigger pre-save hook for slug and level re-calculation

    res.status(200).json(category);
  } catch (err) {
    // If a file was newly uploaded and an error occurred during DB save, delete the file
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error updating category:', err); // Log for debugging
    // Handle specific unique key errors (e.g., slug, name)
    if (err.code === 11000 && err.keyPattern.slug) {
      return res.status(400).json({ error: 'Generated slug already exists. Please modify category name.' });
    }
    if (err.code === 11000 && err.keyPattern.name) {
      return res.status(400).json({ error: 'Category name already exists.' });
    }
    // Handle custom errors from pre-save hooks
    if (err.statusCode === 400) { // For errors originating from our schema pre-save (e.g., parent not found)
        return res.status(400).json({ error: err.message });
    }
    res.status(500).json({
      error: 'Failed to update category',
      details: err.message
    });
  }
};


// Delete category (Admin Only)
exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check if category has subcategories
    const hasSubcategories = await Category.exists({ parent: req.params.id });
    if (hasSubcategories) {
      return res.status(400).json({ error: 'Cannot delete category with subcategories. Please delete subcategories first.' });
    }

    // Check if category is used by products
    const isUsedByProducts = await Product.exists({ category: req.params.id });
    if (isUsedByProducts) {
      return res.status(400).json({ error: 'Cannot delete category used by products. Please reassign or delete products in this category first.' });
    }

    // Delete category image if exists and is not the default placeholder
    if (category.image && !category.image.includes('placehold.co')) {
      const imagePath = path.join(__dirname, '../public', category.image);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    await Category.findByIdAndDelete(req.params.id);

    res.status(200).json({ message: 'Category deleted successfully' });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to delete category',
      details: err.message
    });
  }
};

// Get category tree (hierarchical structure)
exports.getCategoryTree = async (req, res) => {
  try {
    const categories = await Category.find().sort({ sortOrder: 1, name: 1 });

    // Helper function to build tree
    const buildTree = (items, parentId = null) => {
      const result = [];

      items
        .filter(item =>
          (parentId === null && !item.parent) ||
          (item.parent && item.parent.toString() === parentId)
        )
        .forEach(item => {
          const children = buildTree(items, item._id.toString());
          // Only include children array if there are actual children
          const itemObject = item.toObject();
          if (children.length > 0) {
            itemObject.children = children;
          }
          result.push(itemObject);
        });

      return result;
    };

    const tree = buildTree(categories);

    res.status(200).json(tree);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to fetch category tree',
      details: err.message
    });
  }
};
