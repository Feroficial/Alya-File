const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gcuvitntyjiahpzpfzer.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_RheK_MsEe-YffOuR9XMmjQ_Mpcutq1o';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configurar Multer (memoria)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }
});

// ============ RUTAS DE AUTENTICACIÓN ============

// Registro de usuario
app.post('/api/register', async (req, res) => {
    const { email, password, username } = req.body;
    
    if (!email || !password || !username) {
        return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    try {
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    username: username,
                    full_name: username
                }
            }
        });

        if (error) throw error;

        // Crear tabla para archivos del usuario
        const { error: tableError } = await supabase
            .from('user_files')
            .insert([
                { user_id: data.user.id, files: [] }
            ]);

        res.json({ success: true, message: 'Usuario creado exitosamente' });
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(400).json({ error: error.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        res.json({ 
            success: true, 
            token: data.session.access_token,
            user: {
                id: data.user.id,
                email: data.user.email,
                username: data.user.user_metadata.username
            }
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(401).json({ error: 'Credenciales incorrectas' });
    }
});

// Verificar token
app.post('/api/verify', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error) throw error;
        
        res.json({ valid: true, user: user });
    } catch (error) {
        res.status(401).json({ valid: false, error: error.message });
    }
});

// Cerrar sesión
app.post('/api/logout', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token) {
        await supabase.auth.signOut();
    }
    res.json({ success: true });
});

// ============ RUTAS DE ARCHIVOS ============

// Subir archivo (solo autenticado)
app.post('/api/upload', upload.single('file'), async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    // Verificar usuario
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
        return res.status(401).json({ error: 'Token inválido' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const randomName = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(req.file.originalname);
    const fileName = `${user.id}/${randomName}${ext}`;

    try {
        // Subir a Supabase Storage
        const { data, error } = await supabase.storage
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

        // Guardar metadata en la tabla user_files
        const fileMetadata = {
            id: randomName,
            name: req.file.originalname,
            url: publicUrl,
            size: req.file.size,
            type: req.file.mimetype,
            date: new Date().toISOString()
        };

        // Obtener archivos actuales del usuario
        const { data: existingFiles, error: fetchError } = await supabase
            .from('user_files')
            .select('files')
            .eq('user_id', user.id)
            .single();

        let currentFiles = existingFiles?.files || [];
        currentFiles.push(fileMetadata);

        // Actualizar la lista
        const { error: updateError } = await supabase
            .from('user_files')
            .upsert({ 
                user_id: user.id, 
                files: currentFiles 
            });

        if (updateError) throw updateError;

        res.json({ 
            success: true, 
            url: publicUrl,
            file: fileMetadata
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error uploading file' });
    }
});

// Obtener archivos del usuario
app.get('/api/my-files', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
        return res.status(401).json({ error: 'Token inválido' });
    }

    try {
        const { data, error } = await supabase
            .from('user_files')
            .select('files')
            .eq('user_id', user.id)
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        res.json({ files: data?.files || [] });
    } catch (error) {
        console.error('Error:', error);
        res.json({ files: [] });
    }
});

// Eliminar archivo
app.delete('/api/delete/:fileId', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
        return res.status(401).json({ error: 'Token inválido' });
    }

    const { fileId } = req.params;

    try {
        // Eliminar de Storage
        const filePath = `${user.id}/${fileId}`;
        const { error: storageError } = await supabase.storage
            .from('cdn-imagenes')
            .remove([filePath]);

        if (storageError) throw storageError;

        // Eliminar metadata
        const { data: existingFiles } = await supabase
            .from('user_files')
            .select('files')
            .eq('user_id', user.id)
            .single();

        const currentFiles = existingFiles?.files || [];
        const updatedFiles = currentFiles.filter(f => f.id !== fileId);

        await supabase
            .from('user_files')
            .upsert({ user_id: user.id, files: updatedFiles });

        res.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error deleting file' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});