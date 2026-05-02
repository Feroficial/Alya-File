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
app.use(express.static('public'));

// Configurar Multer (solo para procesar archivos en memoria, no disco)
const storage = multer.memoryStorage(); // Importante: usa memoria, no disco
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// Ruta para subir archivos
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generar nombre único
    const randomName = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(req.file.originalname);
    const fileName = `${randomName}${ext}`;

    try {
        // Subir a Supabase Storage
        const { data, error } = await supabase.storage
            .from('cdn-imagenes') // nombre de tu bucket
            .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                cacheControl: '3600',
                upsert: false
            });

        if (error) throw error;

        // Obtener URL pública
        const { data: { publicUrl } } = supabase.storage
            .from('cdn-imagenes')
            .getPublicUrl(fileName);

        res.json({ url: publicUrl });

    } catch (error) {
        console.error('Error subiendo a Supabase:', error);
        res.status(500).json({ error: 'Error uploading to storage' });
    }
});

// Todavía podés mantener el endpoint viejo si querés, pero no lo recomiendo
app.get('/f/:filename', (req, res) => {
    res.status(410).json({ error: 'Files are now served from Supabase directly' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Using Supabase bucket: cdn-imagenes`);
});