require('dotenv').config(); // تحميل متغيرات البيئة
const express = require('express');
const path = require('path');
const supabase = require('./db'); // استدعاء ملف الاتصال الجديد
const multer = require('multer');
const session = require('express-session');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ------------------ إعداد الجلسة (Session) ------------------
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 2 } 
}));

// ------------------ دوال التحقق من الصلاحيات ------------------
function ensureAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  
  const acceptsJson = req.headers.accept && req.headers.accept.indexOf('application/json') !== -1;
  if (acceptsJson) return res.status(401).json({ error: '🚫 الوصول مرفوض، يرجى تسجيل الدخول' });
  return res.status(401).send('<h2>🚫 وصول مرفوض</h2>');
}

// حماية مسار الأدمن (HTML)
app.use((req, res, next) => {
  if (req.path.startsWith('/Admin-Html')) {
    if (req.session && req.session.authenticated) return next();
    return res.status(401).send('<h2>🚫 وصول مرفوض</h2>');
  }
  next();
});

// ------------------ الملفات الاستاتيكية ------------------
app.use(express.static(path.join(__dirname, 'HTML')));
app.use('/CSS', express.static(path.join(__dirname, 'CSS')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ------------------ إعداد Multer (رفع الصور محلياً) ------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage });

// الصفحة الرئيسية
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'HTML/Intro-Html/intro.html')));

// ------------------ تسجيل الدخول (Login) ------------------
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const { data: user, error } = await supabase
      .from('admin')
      .select('*')
      .eq('username', username)
      .single();

    // --- أضف هذه الأسطر لطباعة النتيجة في التيرمينال ---
    console.log('Username sent:', username);
    console.log('Supabase Data:', user);
    console.log('Supabase Error:', error);
    // -----------------------------------------------

    if (error || !user) return res.status(401).send('<h2>❌ اسم المستخدم غير موجود</h2>');
    if (user.password !== password) return res.status(401).send('<h2>❌ كلمة المرور غير صحيحة</h2>');
    
    req.session.authenticated = true;
    req.session.adminUser = username;
    return res.sendFile(path.join(__dirname, 'HTML/Admin-Html/admin.html'));
  } catch (err) {
    console.log('Server Error:', err); // طباعة أخطاء السيرفر
    return res.status(500).send(`<h2>خطأ: ${err.message}</h2>`);
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'فشل تسجيل الخروج' });
    res.json({ message: '✅ تم تسجيل الخروج' });
  });
});

// ------------------ التصنيفات (Categories) ------------------
app.get('/categories', async (req, res) => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('name', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/categories', ensureAuth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '⚠️ اسم التصنيف مطلوب' });

  const { data, error } = await supabase
    .from('categories')
    .insert([{ name }])
    .select(); // select لإرجاع الـ ID الجديد

  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.put('/categories/:id', ensureAuth, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '⚠️ اسم التصنيف مطلوب' });

  const { error } = await supabase
    .from('categories')
    .update({ name })
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: '✅ تم تحديث التصنيف' });
});

app.delete('/categories/:id', ensureAuth, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: '🗑️ تم حذف التصنيف بنجاح' });
});

// ------------------ المنتجات (Products) ------------------

// إضافة منتج جديد
app.post('/products', ensureAuth, upload.array('images', 10), async (req, res) => {
  const { name, description, price, category_id, colors, sizes } = req.body;
  
  let imagePaths = [];
  if (req.files && req.files.length > 0) {
    imagePaths = req.files.map(f => '/uploads/' + f.filename);
  }
  
  const mainImage = imagePaths.length > 0 ? imagePaths[0] : null;
  const imagesJson = JSON.stringify(imagePaths);

  if (!name || !price) return res.status(400).json({ error: '⚠️ اسم المنتج والسعر مطلوبان' });

  // تحويل category_id إلى رقم أو null
  const catId = category_id ? parseInt(category_id) : null;

  const { data, error } = await supabase
    .from('products')
    .insert([{
      image: mainImage,
      images: imagesJson,
      name,
      description: description || null,
      price: parseFloat(price),
      category_id: catId,
      colors: colors || null,
      sizes: sizes || null
    }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  
  const newProduct = data[0];
  // إعادة تنسيق المصفوفة للفرونت اند
  newProduct.images = imagePaths;
  res.json(newProduct);
});

// عرض كل المنتجات
app.get('/products', async (req, res) => {
  // جلب المنتجات مع اسم التصنيف (Join)
  const { data, error } = await supabase
    .from('products')
    .select('*, categories(name)');

  if (error) return res.status(500).json({ error: error.message });

  const products = data.map(p => {
    // معالجة الصور
    try {
      p.images = p.images ? JSON.parse(p.images) : (p.image ? [p.image] : []);
    } catch (e) {
      p.images = [];
    }
    
    // تسوية كائن التصنيف ليناسب الفرونت اند القديم
    // Supabase يرجع: categories: { name: '...' }
    // الفرونت يتوقع: category_name: '...'
    if (p.categories) {
      p.category_name = p.categories.name;
      delete p.categories;
    } else {
      p.category_name = null;
    }
    return p;
  });

  res.json(products);
});

// عرض منتج واحد
app.get('/products/:id', async (req, res) => {
  const { data: row, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !row) return res.status(404).json({ error: '🚫 المنتج غير موجود' });
  
  try {
    row.images = row.images ? JSON.parse(row.images) : (row.image ? [row.image] : []);
  } catch (e) {
    row.images = [];
  }
  
  res.json(row);
});

// تعديل منتج
app.put('/products/:id', ensureAuth, upload.array('images', 10), async (req, res) => {
  const { id } = req.params;
  const { name, description, price, category_id, colors, sizes } = req.body;

  // 1. جلب البيانات القديمة
  const { data: oldRow, error: fetchError } = await supabase
    .from('products')
    .select('image, images')
    .eq('id', id)
    .single();

  if (fetchError || !oldRow) return res.status(404).json({ error: '🚫 المنتج غير موجود' });

  let finalMainImage = oldRow.image;
  let finalImagesJson = oldRow.images;

  // 2. تحديث الصور إذا وجدت جديدة
  if (req.files && req.files.length > 0) {
      const newPaths = req.files.map(f => '/uploads/' + f.filename);
      finalMainImage = newPaths[0];
      finalImagesJson = JSON.stringify(newPaths);
  }

  const catId = category_id ? parseInt(category_id) : null;

  // 3. التحديث في القاعدة
  const { error } = await supabase
    .from('products')
    .update({
      image: finalMainImage,
      images: finalImagesJson,
      name,
      description: description || null,
      price: parseFloat(price),
      category_id: catId,
      colors: colors || null,
      sizes: sizes || null
    })
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: '✅ تم تعديل المنتج بنجاح' });
});

app.delete('/products/:id', ensureAuth, async (req, res) => {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: '🗑️ تم حذف المنتج بنجاح' });
});

// ------------------ الطلبات (Orders) ------------------
app.post('/orders', async (req, res) => {
  const { product_id, customer_name, customer_phone, customer_address, quantity, customer_notes, color, size } = req.body;
  
  if(!product_id || !customer_name || !customer_phone || !customer_address || !quantity)
    return res.status(400).json({ error:'⚠️ يرجى إدخال جميع البيانات الأساسية' });

  // 1. جلب سعر المنتج
  const { data: product, error: prodError } = await supabase
    .from('products')
    .select('name, price')
    .eq('id', product_id)
    .single();

  if(prodError || !product) return res.status(400).json({ error:'❌ المنتج غير موجود' });

  const total_price = product.price * quantity;

  // 2. إدخال الطلب
  const { data: newOrder, error } = await supabase
    .from('orders')
    .insert([{
      product_id, 
      customer_name, 
      customer_phone, 
      customer_address, 
      customer_notes: customer_notes || null, 
      quantity, 
      product_price: product.price, 
      total_price, 
      customer_color: color || null, 
      customer_size: size || null
    }])
    .select();

  if(error) return res.status(500).json({ error:'❌ فشل إنشاء الطلب: ' + error.message });

  res.json({ 
    message:'✅ تم إنشاء الطلب بنجاح', 
    order_id: newOrder[0].id, 
    product_name: product.name, 
    product_price: product.price, 
    total_price 
  });
});

app.get('/orders', ensureAuth, async (req, res) => {
  // جلب الطلبات مع اسم المنتج وترتيب عكسي حسب التاريخ
  const { data, error } = await supabase
    .from('orders')
    .select('*, products(name)')
    .order('created_at', { ascending: false });

  if(error) return res.status(500).json({ error: error.message });

  // تنسيق النتائج (إخراج اسم المنتج من الكائن المتداخل)
  const orders = data.map(o => {
    if (o.products) {
      o.product_name = o.products.name;
      delete o.products;
    } else {
      o.product_name = 'منتج محذوف';
    }
    return o;
  });

  res.json(orders);
});

app.put('/orders/:id/confirm', ensureAuth, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('orders')
    .update({ status: 'confirmed' })
    .eq('id', id);

  if(error) return res.status(500).json({ error: error.message });
  res.json({ message:'✅ تم تأكيد الطلب بنجاح' });
});

app.delete('/orders/:id', ensureAuth, async (req, res) => {
  const { error } = await supabase
    .from('orders')
    .delete()
    .eq('id', req.params.id);

  if(error) return res.status(500).json({ error: error.message });
  res.json({ message:'🗑️ تم حذف الطلب بنجاح' });
});

// ------------------ تشغيل الخادم ------------------
const PORT = 3000;
app.listen(PORT, ()=> console.log(`🚀 Server running on http://localhost:${PORT}`));
