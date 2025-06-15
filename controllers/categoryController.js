const Category = require('../models/Category');
const Product = require('../models/Product');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

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
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '-').toLowerCase()}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
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
      .populate('subcategories');
    
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
      .populate('subcategories');
    
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

// Create new category
exports.createCategory = async (req, res) => {
  try {
    const { name, description, parent, level, isActive, sortOrder } = req.body;
    
    // Validate required fields
    // if (!name) {
    //   return res.status(400).json({ error: 'Category name is required' });
    // }
    
    // Set image path if uploaded
    let imagePath = '';
    if (req.file) {
      imagePath = `/uploads/categories/${req.file.filename}`;
    }
    
    // Create new category object
    const categoryData = {
      name,
      description,
      image: imagePath,
      isActive: isActive === 'false' ? false : Boolean(isActive)
    };
    
    // Add optional fields if provided
    if (parent) {
      const parentCategory = await Category.findById(parent);
      if (!parentCategory) {
        return res.status(400).json({ error: 'Parent category not found' });
      }
      categoryData.parent = parent;
      
      // Set level as parent level + 1
      categoryData.level = parentCategory.level + 1;
    } else if (level) {
      categoryData.level = Number(level);
    }
    
    if (sortOrder) {
      categoryData.sortOrder = Number(sortOrder);
    }
    
    // Create the category
    const category = new Category(categoryData);
    await category.save();
    
    res.status(201).json(category);
  } catch (err) {
    res.status(500).json({ 
      error: 'Failed to create category', 
      details: err.message 
    });
  }
};

// Update category
exports.updateCategory = async (req, res) => {
  try {
    const { name, description, parent, level, isActive, sortOrder } = req.body;
    
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    // Process uploaded image if any
    if (req.file) {
      // Delete old image if exists
      if (category.image) {
        const oldImagePath = path.join(__dirname, '../public', category.image);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
      
      category.image = `/uploads/categories/${req.file.filename}`;
    }
    
    // Update category fields
    if (name) category.name = name;
    if (description !== undefined) category.description = description;
    if (isActive !== undefined) category.isActive = isActive === 'false' ? false : Boolean(isActive);
    if (sortOrder !== undefined) category.sortOrder = Number(sortOrder);
    
    // Update parent relationship
    if (parent !== undefined) {
      // If parent is empty string, set to null (remove parent)
      if (!parent) {
        category.parent = null;
        category.level = 0;
      } else {
        // Make sure we're not creating a circular reference
        if (parent === req.params.id) {
          return res.status(400).json({ error: 'Category cannot be its own parent' });
        }
        
        const parentCategory = await Category.findById(parent);
        if (!parentCategory) {
          return res.status(400).json({ error: 'Parent category not found' });
        }
        
        category.parent = parent;
        category.level = parentCategory.level + 1;
      }
    } else if (level !== undefined) {
      category.level = Number(level);
    }
    
    await category.save();
    
    res.status(200).json(category);
  } catch (err) {
    res.status(500).json({ 
      error: 'Failed to update category', 
      details: err.message 
    });
  }
};

// Delete category
exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    // Check if category has subcategories
    const hasSubcategories = await Category.exists({ parent: req.params.id });
    if (hasSubcategories) {
      return res.status(400).json({ error: 'Cannot delete category with subcategories' });
    }
    
    // Check if category is used by products
    const isUsedByProducts = await Product.exists({ category: req.params.id });
    if (isUsedByProducts) {
      return res.status(400).json({ error: 'Cannot delete category used by products' });
    }
    
    // Delete category image if exists
    if (category.image) {
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
          result.push({
            ...item.toObject(),
            children: children.length ? children : undefined
          });
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