require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const compression = require('compression');
const git = require('simple-git')();
const cron = require('node-cron');
const fs = require('fs');
const app = express();

const uri = process.env.MONGODB_URI;
const pat = process.env.GITHUB_PAT; // Make sure to set this environment variable
const repoUrl = process.env.REPO_URL; // Make sure to set this environment variable

const corsOptions = {
    origin: '*', // You can specify your frontend URL here for better security
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    exposedHeaders: ['x-auth-token']
};

app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(compression()); // Enable gzip compression

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '1d'
}));

mongoose.connect(uri).then(() => {
    console.log('MongoDB connected');
}).catch(err => {
    console.error('MongoDB connection error:', err);
});

// Configure Git user
git.addConfig('user.email', 'jheffcds@gmail.com');
git.addConfig('user.name', 'jheffcds');

// Configure Git to use PAT for authentication
git.addConfig('http.extraheader', `AUTHORIZATION: Basic ${Buffer.from(`jheffcds:${pat}`).toString('base64')}`);

// Clone the repository if the uploads folder does not exist
const localPath = path.join(__dirname, 'uploads');

if (!fs.existsSync(localPath)) {
    git.clone(repoUrl, localPath)
        .then(() => {
            console.log('Repository cloned successfully');
            git.addRemote('origin', repoUrl);
        })
        .catch(err => console.error('Error cloning repository:', err));
} else {
    git.addRemote('origin', repoUrl);
}

// Set up a cron job to pull updates every 30 seconds
cron.schedule('*/30 * * * * *', () => {
    git.pull('origin', 'main', (err, update) => {
        if (err) {
            console.error('Error pulling repository updates:', err);
            return;
        }
        if (update && update.summary.changes) {
            console.log('Repository updated successfully');
        }
    });
});

async function commitAndPushFiles(files) {
    try {
        await git.add(files);
        await git.commit('Add new files');
        await git.push('origin', 'main');
        console.log('Files committed and pushed successfully');
    } catch (err) {
        console.error('Error committing and pushing files:', err);
    }
}

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

        // Commit and push new files
        commitAndPushFiles(files.map(file => file.path));

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

        // Commit and push new profile picture
        commitAndPushFiles([req.file.path]);

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
