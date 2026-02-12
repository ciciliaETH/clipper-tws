
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load .env.local
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('DEBUG: Checking mapping for "clipperfinance"');

  // 1. Check if "clipperfinance" is in user_instagram_usernames
  const { data: directMap, error: err1 } = await supabase
    .from('user_instagram_usernames')
    .select('user_id, instagram_username')
    .eq('instagram_username', 'clipperfinance');
  
  console.log('1. user_instagram_usernames:', directMap, err1 || '');

  // 2. Check if "clipperfinance" is in employee_instagram_participants
  const { data: empMap, error: err2 } = await supabase
    .from('employee_instagram_participants')
    .select('employee_id, instagram_username')
    .eq('instagram_username', 'clipperfinance');

  console.log('2. employee_instagram_participants:', empMap, err2 || '');

  if (empMap && empMap.length > 0) {
      const empId = empMap[0].employee_id;
      // 3. Fetch user details for that employee_id
      const { data: user, error: err3 } = await supabase
        .from('users')
        .select('id, full_name, username')
        .eq('id', empId)
        .single();
      console.log('3. User for employee ID:', user, err3 || '');
  }
  
  // 4. Check if there is a main user with this username
  const { data: mainUser, error: err4 } = await supabase
    .from('users')
    .select('id, full_name, username, instagram_username')
    .eq('instagram_username', 'clipperfinance');
  console.log('4. Main User check:', mainUser, err4 || '');

}

main();
