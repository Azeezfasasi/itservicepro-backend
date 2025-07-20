const Project = require('../models/Project');
const { cloudinary, upload } = require('../utils/cloudinary');

// Helper function to delete images from Cloudinary
const deleteCloudinaryImages = async (imagePublicIds) => {
  if (!imagePublicIds || imagePublicIds.length === 0) return;

  try {
    const results = await cloudinary.api.delete_resources(imagePublicIds);
    console.log('Cloudinary deletion results:', results);
  } catch (error) {
    console.error('Error deleting images from Cloudinary:', error);
  }
};

// @desc    Create a new project
// @route   POST /api/projects
// @access  Admin/Super Admin
exports.createProject = async (req, res) => {
  console.log('--- Project Controller: Entering createProject ---');
  console.log('Req Body:', req.body);
  console.log('Req Files:', req.files); // Files will be in req.files from multer

  try {
    const { title, category, description, technologyUsed, clientIndustry, link, icon } = req.body;

    if (!title || !category || !description || !technologyUsed || !clientIndustry || !icon) {
      if (req.files && req.files.length > 0) {
        const publicIds = req.files.map(file => file.public_id);
        await deleteCloudinaryImages(publicIds);
      }
      return res.status(400).json({ message: 'Please fill all required fields: title, category, description, technologyUsed, clientIndustry, icon.' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'At least one image is required for the project.' });
    }

    const projectImages = req.files.map(file => ({
      url: file.path,
      public_id: file.filename,
    }));

    const newProject = new Project({
      title,
      category,
      description,
      technologyUsed,
      clientIndustry,
      link: link || '#',
      icon,
      images: projectImages,
    });

    const createdProject = await newProject.save();
    res.status(201).json({
      message: 'Project created successfully',
      project: createdProject,
    });
    console.log('Project created successfully:', createdProject.title);

  } catch (error) {
    console.error('Error creating project:', error);
    if (req.files && req.files.length > 0) {
      const publicIds = req.files.map(file => file.public_id);
      await deleteCloudinaryImages(publicIds);
    }
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Project with this title already exists.', details: error.message });
    }
    res.status(500).json({ message: 'Failed to create project.', details: error.message });
  }
};


exports.getAllProjects = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1; // Current page, default to 1
    const limit = parseInt(req.query.limit) || 10; // Items per page, default to 10

    const skip = (page - 1) * limit;

    const totalProjects = await Project.countDocuments(); // Get total count for pagination
    const projects = await Project.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(totalProjects / limit);

    res.status(200).json({
      projects,
      currentPage: page,
      totalPages,
      totalProjects,
    });
  } catch (error) {
    console.error('Error fetching all projects with pagination:', error);
    res.status(500).json({ message: 'Failed to fetch projects.', details: error.message });
  }
};

// @desc    Get project by ID
// @route   GET /api/projects/:id
// @access  Public
exports.getProjectById = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found.' });
    }
    res.status(200).json(project);
  } catch (error) {
    console.error('Error fetching project by ID:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid project ID format.' });
    }
    res.status(500).json({ message: 'Failed to fetch project.', details: error.message });
  }
};

// @desc    Update a project
// @route   PUT /api/projects/:id
// @access  Admin/Super Admin
exports.updateProject = async (req, res) => {
  console.log('--- Project Controller: Entering updateProject ---');
  console.log('Req Body:', req.body);
  console.log('Req Files:', req.files);

  try {
    const { id } = req.params;
    const { title, category, description, technologyUsed, clientIndustry, link, icon, existingImagePublicIds } = req.body;

    const project = await Project.findById(id);
    if (!project) {
      if (req.files && req.files.length > 0) {
        const publicIds = req.files.map(file => file.public_id);
        await deleteCloudinaryImages(publicIds);
      }
      return res.status(404).json({ message: 'Project not found.' });
    }

    let currentExistingImagePublicIds = [];
    if (existingImagePublicIds) {
        try {
            currentExistingImagePublicIds = JSON.parse(existingImagePublicIds);
            if (!Array.isArray(currentExistingImagePublicIds)) {
                throw new Error('existingImagePublicIds is not an array.');
            }
        } catch (parseError) {
            console.error('Failed to parse existingImagePublicIds:', parseError);
            return res.status(400).json({ message: 'Invalid format for existing image IDs.' });
        }
    }

    const imagesToDeletePublicIds = [];
    const imagesToKeep = [];

    project.images.forEach(img => {
      if (!currentExistingImagePublicIds.includes(img.public_id)) {
        imagesToDeletePublicIds.push(img.public_id);
      } else {
        imagesToKeep.push(img);
      }
    });

    if (imagesToDeletePublicIds.length > 0) {
      await deleteCloudinaryImages(imagesToDeletePublicIds);
    }

    const newUploadedImages = req.files ? req.files.map(file => ({
      url: file.path,
      public_id: file.filename,
    })) : [];

    const updatedImages = [...imagesToKeep, ...newUploadedImages];

    if (updatedImages.length === 0 && project.images.length > 0) {
        console.warn('Project updated with no images. Consider adding validation if images are mandatory.');
    }

    const updatedProject = await Project.findByIdAndUpdate(
      id,
      {
        title,
        category,
        description,
        technologyUsed,
        clientIndustry,
        link: link || '#',
        icon,
        images: updatedImages,
      },
      { new: true, runValidators: true }
    );

    if (!updatedProject) {
      return res.status(404).json({ message: 'Project not found after update attempt.' });
    }

    res.status(200).json({
      message: 'Project updated successfully',
      project: updatedProject,
    });
    console.log('Project updated successfully:', updatedProject.title);

  } catch (error) {
    console.error('Error updating project:', error);
    if (req.files && req.files.length > 0) {
      const publicIds = req.files.map(file => file.public_id);
      await deleteCloudinaryImages(publicIds);
    }
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid project ID format.' });
    }
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Project with this title already exists.', details: error.message });
    }
    res.status(500).json({ message: 'Failed to update project.', details: error.message });
  }
};

// @desc    Delete a project
// @route   DELETE /api/projects/:id
// @access  Admin/Super Admin
exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found.' });
    }

    const imagePublicIds = project.images.map(img => img.public_id);

    await deleteCloudinaryImages(imagePublicIds);

    await project.deleteOne();
    res.status(200).json({ message: 'Project deleted successfully.' });
    console.log('Project deleted successfully:', project.title);

  } catch (error) {
    console.error('Error deleting project:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid project ID format.' });
    }
    res.status(500).json({ message: 'Failed to delete project.', details: error.message });
  }
};
