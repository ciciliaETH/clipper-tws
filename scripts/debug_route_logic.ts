
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log('--- Simulating Route Logic ---');

    const campaignId = ''; 
    let employeeIds: string[] = [];

    // 1. Get employees
    if (!campaignId) {
      const { data: emps } = await supabase
        .from('users')
        .select('id, username, role')
        .eq('role','karyawan')
      employeeIds = (emps||[]).map((r:any)=> String(r.id))
      
      // CHECK IF HAIKAL IS IN HERE
      const haikalId = 'b93e96b9-128e-478c-93c2-34aa01a9c956';
      const haikalFound = employeeIds.includes(haikalId);
      console.log(`Is Haikal (${haikalId}) in employeeIds? ${haikalFound}`);
      console.log('Employee IDs count:', employeeIds.length);

      if (!haikalFound) {
          console.log('WARNING: Haikal is NOT in employee list. Checking his role...');
          const { data: hUser } = await supabase.from('users').select('*').eq('id', haikalId).single();
          console.log('Haikal User Data:', hUser);
      }
    }

    // 2. Get Users
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, full_name, username, tiktok_username, instagram_username, youtube_channel_id')
      .in('id', employeeIds)
    
    if (userError) console.error('Error fetching users:', userError);
    console.log('Users fetched count:', users?.length);

    
    // 3. Get Aliases
    const { data: ttAliases } = await supabase
      .from('user_tiktok_usernames')
      .select('user_id, tiktok_username')
      .in('user_id', employeeIds);

    const { data: igAliases } = await supabase
      .from('user_instagram_usernames')
      .select('user_id, instagram_username')
      .in('user_id', employeeIds);

    // 4. Get Employee Participants (The fix I added)
    const { data: ttEmpParts } = await supabase
      .from('employee_participants')
      .select('employee_id, tiktok_username')
      .in('employee_id', employeeIds);

    const { data: igEmpParts } = await supabase
      .from('employee_instagram_participants')
      .select('employee_id, instagram_username')
      .in('employee_id', employeeIds);

    // 5. Build Maps
    const userMap = new Map<string, any>()
    for (const u of users || []) {
      userMap.set(u.id, {
        name: u.full_name || u.username || u.tiktok_username || u.instagram_username || u.id,
      })
    }

    const igUserToId = new Map<string, string>();
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g,'').replace(/^@+/,'');

    // Populate from users
    for(const u of users || []) {
        if(u.instagram_username) igUserToId.set(norm(u.instagram_username), u.id);
    }
    // Populate from aliases
    for(const a of igAliases || []) {
        if(a.instagram_username) igUserToId.set(norm(a.instagram_username), a.user_id);
    }
    // Populate from employee participants
    for(const a of igEmpParts || []) {
        if(a.instagram_username) igUserToId.set(norm(a.instagram_username), a.employee_id);
    }

    console.log('igUserToId size:', igUserToId.size);
    console.log('Has clipperfinance?', igUserToId.has('clipperfinance'));
    if (igUserToId.has('clipperfinance')) {
        const id = igUserToId.get('clipperfinance');
        console.log('Mapped ID:', id);
        console.log('UserMap has ID?', userMap.has(id!));
        if (userMap.has(id!)) {
            console.log('Mapped Name:', userMap.get(id!).name);
        } else {
             console.log('UserMap DOES NOT HAVE ID. This assumes Haikal is not in "users" fetch result?');
             // Double check users array
             const u = users?.find((x:any) => x.id === id);
             console.log('User in "users" array?', u);
        }
    }
}

main();
