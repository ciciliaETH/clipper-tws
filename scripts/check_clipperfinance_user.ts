
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

console.log('Connecting to Supabase:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log('Searching for users with username like "clipperfinance"...');
    
    // Check users table
    const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .or(`username.eq.clipperfinance,tiktok_username.eq.clipperfinance,instagram_username.eq.clipperfinance`);

    if (error) {
        console.error('Error fetching users:', error);
        return;
    }

    console.log('Found users:', JSON.stringify(users, null, 2));

    if (users && users.length > 0) {
        const userId = users[0].id; // Assuming first match is the one
        // Check if there are aliases
        const { data: aliases } = await supabase.from('employee_participants').select('*').eq('tiktok_username', 'clipperfinance');
        console.log('Found aliases:', aliases);
    }
}

main();
