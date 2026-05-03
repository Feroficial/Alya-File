const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// Directorio para uploads (usar /data en Fly.io o local)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

// Asegurar que existe el directorio
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configurar Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const randomName = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname);
        cb(null, `${randomName}${ext}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// ============ RUTAS ============

// Subir archivo
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `${req.protocol}://${req.get('host')}/files/${req.file.filename}`;
    
    res.json({ 
        success: true, 
        url: fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size
    });
});

// Servir archivos
app.get('/files/:filename', (req, res) => {
    const filePath = path.join(UPLOAD_DIR, req.params.filename);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('File not found');
    }
});

// Listar archivos subidos
app.get('/files', (req, res) => {
    fs.readdir(UPLOAD_DIR, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Error reading files' });
        }
        
        const fileList = files.map(file => ({
            filename: file,
            url: `${req.protocol}://${req.get('host')}/files/${file}`,
            size: fs.statSync(path.join(UPLOAD_DIR, file)).size,
            uploaded: fs.statSync(path.join(UPLOAD_DIR, file)).mtime
        }));
        
        res.json({ files: fileList });
    });
});

// Eliminar archivo
app.delete('/files/:filename', (req, res) => {
    const filePath = path.join(UPLOAD_DIR, req.params.filename);
    
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true, message: 'File deleted' });
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Uploads directory: ${UPLOAD_DIR}`);
});