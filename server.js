const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');

const app = express();
const PORT = process.env.PORT || 3000;

// Variables de entorno (configuradas en Render)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage() });

// Subir archivo a GitHub
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileName = `${Date.now()}-${req.file.originalname}`;
    const contentBase64 = req.file.buffer.toString('base64');

    try {
        await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: fileName,
            message: `Upload ${fileName}`,
            content: contentBase64,
            branch: 'main'
        });

        const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${fileName}`;
        
        res.json({ 
            success: true, 
            url: url,
            filename: fileName,
            originalName: req.file.originalname,
            size: req.file.size
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error uploading to GitHub' });
    }
});

// Listar archivos
app.get('/files', async (req, res) => {
    try {
        const response = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: ''
        });

        const files = response.data.map(file => ({
            filename: file.name,
            url: `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${file.name}`,
            size: file.size,
            uploaded: file.sha
        }));

        res.json({ files });
    } catch (error) {
        if (error.status === 404) {
            res.json({ files: [] });
        } else {
            res.status(500).json({ error: 'Error listing files' });
        }
    }
});

// Eliminar archivo
app.delete('/files/:filename', async (req, res) => {
    const filename = req.params.filename;

    try {
        // Primero obtener el SHA del archivo
        const fileInfo = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filename
        });

        await octokit.repos.deleteFile({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filename,
            message: `Delete ${filename}`,
            sha: fileInfo.data.sha,
            branch: 'main'
        });

        res.json({ success: true });
    } catch (error) {
        res.status(404).json({ error: 'File not found' });
    }
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`GitHub repo: ${GITHUB_OWNER}/${GITHUB_REPO}`);
});