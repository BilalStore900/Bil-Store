
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('⚠️ الرجاء التأكد من وجود SUPABASE_URL و SUPABASE_KEY في ملف .env');
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('✅ تم تهيئة الاتصال بـ Supabase');

module.exports = supabase;  
  
