const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mi_secreto_super_seguro_2024';

// Configuración de Supabase (SOLO PARA IMÁGENES)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gcuvitntyjiahpzpfzer.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_RheK_MsEe-YffOuR9XMmjQ_Mpcutq1o';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Archivo para guardar usuarios
const USERS_FILE = path.join(__dirname, 'users.json');

// Inicializar archivo de usuarios si no existe
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}

// ============ FUNCIONES DE USUARIOS ============

function getUsers() {
    const data = fs.readFileSync(USERS_FILE);
    return JSON.parse(data);
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ============ RUTAS DE AUTENTICACIÓN (LOCAL) ============

// Registro de usuario
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const users = getUsers();
    
    // Verificar si el email ya existe
    if (users.find(u => u.email === email)) {
        return res.status(400).json({ error: 'El email ya está registrado' });
    }
    
    // Verificar si el username ya existe
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'El nombre de usuario ya existe' });
    }

    try {
        // Hashear contraseña
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Crear nuevo usuario
        const newUser = {
            id: crypto.randomBytes(16).toString('hex'),
            username,
            email,
            password: hashedPassword,
            createdAt: new Date().toISOString()
        };
        
        users.push(newUser);
        saveUsers(users);
        
        res.json({ success: true, message: 'Usuario creado exitosamente' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al crear usuario' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    const users = getUsers();
    const user = users.find(u => u.email === email);
    
    if (!user) {
        return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    
    try {
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }
        
        // Generar token JWT
        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                username: user.username
            }
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
});

// Verificar token
app.post('/api/verify', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({ valid: true, user: decoded });
    } catch (error) {
        res.status(401).json({ valid: false, error: 'Token inválido' });
    }
});

// ============ RUTAS DE ARCHIVOS (Con Supabase) ============

// Middleware para verificar token
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token inválido' });
    }
}

const upload = multer({ storage: multer.memoryStorage() });

// Subir archivo a Supabase
app.post('/api/upload', authMiddleware, upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const randomName = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(req.file.originalname);
    const fileName = `${req.user.id}/${randomName}${ext}`;

    try {
        // Subir a Supabase
        const { error } = await supabase.storage
            .from('cdn-imagenes')
            .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                cacheControl: '3600'
            });

        if (error) throw error;

        // Obtener URL pública
        const { data: { publicUrl } } = supabase.storage
            .from('cdn-imagenes')
            .getPublicUrl(fileName);

        // Guardar metadata en archivo local (cada usuario tiene su archivo)
        const userFilesFile = path.join(__dirname, `user_files_${req.user.id}.json`);
        let userFiles = [];
        
        if (fs.existsSync(userFilesFile)) {
            const data = fs.readFileSync(userFilesFile);
            userFiles = JSON.parse(data);
        }
        
        const fileMetadata = {
            id: randomName,
            name: req.file.originalname,
            url: publicUrl,
            size: req.file.size,
            type: req.file.mimetype,
            date: new Date().toISOString()
        };
        
        userFiles.push(fileMetadata);
        fs.writeFileSync(userFilesFile, JSON.stringify(userFiles, null, 2));
        
        res.json({ success: true, url: publicUrl, file: fileMetadata });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error uploading file' });
    }
});

// Obtener archivos del usuario
app.get('/api/my-files', authMiddleware, (req, res) => {
    const userFilesFile = path.join(__dirname, `user_files_${req.user.id}.json`);
    
    if (!fs.existsSync(userFilesFile)) {
        return res.json({ files: [] });
    }
    
    try {
        const data = fs.readFileSync(userFilesFile);
        const files = JSON.parse(data);
        res.json({ files });
    } catch (error) {
        res.json({ files: [] });
    }
});

// Eliminar archivo
app.delete('/api/delete/:fileId', authMiddleware, async (req, res) => {
    const { fileId } = req.params;
    const userFilesFile = path.join(__dirname, `user_files_${req.user.id}.json`);
    
    if (!fs.existsSync(userFilesFile)) {
        return res.status(404).json({ error: 'No files found' });
    }
    
    try {
        const data = fs.readFileSync(userFilesFile);
        let userFiles = JSON.parse(data);
        const fileToDelete = userFiles.find(f => f.id === fileId);
        
        if (!fileToDelete) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Eliminar de Supabase
        const filePath = `${req.user.id}/${fileId}${path.extname(fileToDelete.name)}`;
        await supabase.storage.from('cdn-imagenes').remove([filePath]);
        
        // Eliminar metadata
        userFiles = userFiles.filter(f => f.id !== fileId);
        fs.writeFileSync(userFilesFile, JSON.stringify(userFiles, null, 2));
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error deleting file' });
    }
});

// Servir index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});