const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const compression = require('compression');
const app = express();

const uri = process.env.MONGODB_URI;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(compression()); // Enable gzip compression

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '1d'
}));

mongoose.connect(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => {
    console.log('MongoDB connected');
}).catch(err => {
    console.error('MongoDB connection error:', err);
});

// Define User Schema
const userSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    dob: Date,
    gender: String,
    profilePicture: String
});

const User = mongoose.model('User', userSchema);

// Define Post Schema
const postSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    imageUrl: [String], // Store multiple image URLs
    createdAt: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);

// Define Section Schema for Portfolio
const sectionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sectionId: { type: String, required: true },
    content: { type: String, required: true },
});

const Section = mongoose.model('Section', sectionSchema);

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname)); // Append the correct extension
    }
});

const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

// Register Endpoint
app.post('/register', upload.single('profilePicture'), async (req, res) => {
    const { email, username, password, dob, gender } = req.body;
    const profilePicture = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).json({ message: 'Email or username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({ email, username, password: hashedPassword, dob, gender, profilePicture });
        await user.save();

        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Login Endpoint
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ message: 'Invalid username or password' });
        }

        res.status(200).json({
            username: user.username,
            profilePicture: user.profilePicture, // Send the URL
            userId: user._id
        });
    } catch (error) {
        console.error('Error logging in user:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Create Post Endpoint
app.post('/create-post', upload.array('media', 10), async (req, res) => {
    const { userId, content } = req.body;
    const files = req.files;

    try {
        const imageUrl = files.map(file => `/uploads/${file.filename}`);

        const post = new Post({ userId, content, imageUrl });
        await post.save();
        res.status(201).json({ message: 'Post created successfully', imageUrl });
    } catch (error) {
        console.error('Error creating post:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get User's Posts Endpoint
app.get('/user-posts/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const posts = await Post.find({ userId })
            .populate('userId', 'username profilePicture')
            .sort({ createdAt: -1 }); // Sort by createdAt in descending order
        res.status(200).json(posts);
    } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update Profile Picture Endpoint
app.post('/update-profile-picture', upload.single('profilePicture'), async (req, res) => {
    const { userId } = req.body;
    const profilePicture = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        user.profilePicture = profilePicture;
        await user.save();

        res.status(200).json({ message: 'Profile picture updated successfully', profilePicture });
    } catch (error) {
        console.error('Error updating profile picture:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Search Users Endpoint
app.get('/search-users', async (req, res) => {
    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ message: 'Query parameter is required' });
    }

    try {
        const users = await User.find({ username: { $regex: query, $options: 'i' } }).select('username');
        res.status(200).json(users);
    } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get User Info Endpoint
app.get('/users/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const user = await User.findById(userId).select('username profilePicture');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.status(200).json(user);
    } catch (error) {
        console.error('Error fetching user info:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Save Section Content Endpoint
app.post('/save-section', async (req, res) => {
    const { userId, sectionId, content } = req.body;

    try {
        const section = await Section.findOneAndUpdate(
            { userId, sectionId },
            { content },
            { new: true, upsert: true }
        );
        res.status(200).json(section);
    } catch (error) {
        console.error('Error saving section:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete Post Endpoint
app.delete('/delete-post/:postId', async (req, res) => {
    const { postId } = req.params;

    try {
        await Post.findByIdAndDelete(postId);
        res.status(200).json({ message: 'Post deleted successfully' });
    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Get Sections Content Endpoint
app.get('/get-sections/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const sections = await Section.find({ userId });
        const data = sections.reduce((acc, section) => {
            acc[section.sectionId] = section.content;
            return acc;
        }, {});

        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching sections:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
