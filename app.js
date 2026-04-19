// 1. Initialize Supabase
const supabaseUrl = 'https://etdkanqajrcxjytfxyyq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0ZGthbnFhanJjeGp5dGZ4eXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1OTIwNDYsImV4cCI6MjA5MjE2ODA0Nn0.-3KH6A6tfNvCeXPl7UIB92gL5BiO77ZrDEwlkbkZ1Ns';
const client = window.supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = null;
let userProfile = null;

// --- App Initialization ---
async function initializeApp() {
    // 1. Grab the session explicitly on load
    const { data: { session } } = await client.auth.getSession();
    await updateAuthState(session);
    
    // 2. Load the feed ONCE after the session is cleanly established
    loadFeed();

    // 3. Listen for FUTURE auth changes (Login/Logout)
    client.auth.onAuthStateChange(async (event, session) => {
        // Ignore the initial session event to prevent duplicate locked requests
        if (event === 'INITIAL_SESSION') return; 
        
        await updateAuthState(session);
        loadFeed(); // Refresh the feed so likes/UI update for the new user
    });
}

// Helper to handle user state
async function updateAuthState(session) {
    currentUser = session?.user || null;
    document.getElementById('profileBtn').innerText = currentUser ? "Profile" : "Login";
    
    if (currentUser) {
        await loadUserProfile();
    } else {
        userProfile = null;
    }
}

// Boot up the app
initializeApp();

// --- Modal Controls ---
// ... (keep the rest of your app.js the exact same below this line)

// --- Modal Controls ---
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

function handleProfileClick() {
    if (currentUser) showModal('profileModal');
    else showModal('authModal');
}

function handleUploadClick() {
    if (!currentUser) {
        alert("Please login to upload.");
        showModal('authModal');
    } else {
        showModal('uploadModal');
    }
}

// --- Authentication ---
async function signUp() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) alert(error.message);
    else { alert("Check your email for confirmation!"); hideModal('authModal'); }
}

async function signIn() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    else hideModal('authModal');
}

async function signOut() {
    await client.auth.signOut();
    hideModal('profileModal');
}

// --- Profile Management ---
async function loadUserProfile() {
    // CHANGE .single() to .maybeSingle()
    const { data, error } = await client.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    
    if (data) {
        userProfile = data;
        document.getElementById('username').value = data.username || '';
        document.getElementById('bio').value = data.bio || '';
        if (data.avatar_url) {
            document.getElementById('avatarPreview').style.backgroundImage = `url(${data.avatar_url})`;
        }
    }
}
async function saveProfile() {
    const statusText = document.getElementById('profileStatus');
    statusText.innerText = "Saving...";
    
    const username = document.getElementById('username').value;
    const bio = document.getElementById('bio').value;
    const avatarFile = document.getElementById('avatarInput').files[0];
    let avatar_url = userProfile?.avatar_url || null;

    if (avatarFile) {
        const fileName = `${currentUser.id}_${Date.now()}`;
        const { data: uploadData, error: uploadError } = await client.storage.from('avatars').upload(fileName, avatarFile);
        if (!uploadError) {
            const { data } = client.storage.from('avatars').getPublicUrl(fileName);
            avatar_url = data.publicUrl;
        }
    }

    const { error } = await client.from('profiles').upsert({
        id: currentUser.id, username, bio, avatar_url
    });

    if (error) statusText.innerText = "Error saving profile.";
    else {
        statusText.innerText = "Saved successfully!";
        await loadUserProfile();
        setTimeout(() => hideModal('profileModal'), 1000);
        loadFeed(); // Refresh feed to show new profile details
    }
}

// --- View Other Users Profile ---
async function viewProfile(userId) {
    showModal('viewProfileModal');
    document.getElementById('viewUsername').innerText = "Loading...";
    document.getElementById('viewBio').innerText = "";
    document.getElementById('viewAvatar').style.backgroundImage = "none";
    
    const grid = document.getElementById('viewProfilePosts');
    grid.innerHTML = ""; // Clear old posts

    // Fetch Profile Info
    const { data: profile } = await client.from('profiles').select('*').eq('id', userId).single();
    if (profile) {
        document.getElementById('viewUsername').innerText = "@" + (profile.username || "Anonymous");
        document.getElementById('viewBio').innerText = profile.bio || "";
        if (profile.avatar_url) {
            document.getElementById('viewAvatar').style.backgroundImage = `url(${profile.avatar_url})`;
        }
    }

    // Fetch User's Posts
    const { data: posts } = await client.from('posts').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    
    if (posts) {
        posts.forEach(post => {
            const el = document.createElement(post.media_type === 'video' ? 'video' : 'img');
            el.src = post.media_url;
            if (post.media_type === 'video') el.muted = true; // Mute grid videos
            grid.appendChild(el);
        });
    }
}


// --- Fast Media Upload (No Length Limit) ---
async function uploadMedia() {
    const fileInput = document.getElementById('mediaInput');
    const file = fileInput.files[0];
    if (!file) return alert("Select a file");

    const statusText = document.getElementById('uploadStatus');
    statusText.innerText = "Processing upload..."; // Immediate UI feedback to prevent "lag" feel

    // Instantly process based on MIME type, no local loading
    const type = file.type.startsWith('video/') ? 'video' : 'image';
    await processUpload(file, statusText, type);
}

async function processUpload(file, statusText, type) {
    const fileName = `${Date.now()}_${file.name}`;
    const description = document.getElementById('postDescription').value;

    console.log("Starting upload to storage..."); // Debug log
    const { data: storageData, error: storageError } = await client.storage.from('media').upload(fileName, file);
    
    if (storageError) {
        console.error("Storage Error:", storageError); // This will show the real reason
        return statusText.innerText = "Upload Error: " + storageError.message;
    }

    console.log("Storage upload successful, inserting into DB...");
    const { data: publicUrlData } = client.storage.from('media').getPublicUrl(fileName);

    const { error: dbError } = await client.from('posts').insert([
        { user_id: currentUser.id, media_url: publicUrlData.publicUrl, media_type: type, description: description }
    ]);

    if (dbError) {
        console.error("DB Error:", dbError);
        statusText.innerText = "DB Error: " + dbError.message;
    } else {
        statusText.innerText = "Uploaded successfully!";
        document.getElementById('postDescription').value = ""; 
        document.getElementById('mediaInput').value = ""; // Clear file input
        setTimeout(() => {
            hideModal('uploadModal');
            statusText.innerText = "";
        }, 1000);
        loadFeed(); 
    }
}

// --- Likes & Feed ---
async function toggleLike(postId, btnElement, countElement) {
    if (!currentUser) return alert("Please login to like posts!");

    const isLiked = btnElement.classList.contains('liked');

    if (isLiked) {
        await client.from('likes').delete().match({ user_id: currentUser.id, post_id: postId });
        btnElement.classList.remove('liked');
        countElement.innerText = parseInt(countElement.innerText) - 1;
    } else {
        await client.from('likes').insert([{ user_id: currentUser.id, post_id: postId }]);
        btnElement.classList.add('liked');
        countElement.innerText = parseInt(countElement.innerText) + 1;
    }
}

async function loadFeed() {
    const feedContainer = document.getElementById('feed');
    feedContainer.innerHTML = ''; 

    // Fetch posts and join profiles for usernames AND avatars
    const { data: posts, error } = await client
        .from('posts')
        .select(`
            *,
            profiles(username, avatar_url),
            likes(user_id)
        `)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) return console.error(error);

    posts.forEach(post => {
        const postDiv = document.createElement('div');
        postDiv.className = 'post';

        const userHasLiked = currentUser && post.likes.some(like => like.user_id === currentUser.id);
        const likeCount = post.likes.length;
        const authorName = post.profiles?.username || 'Anonymous';
        const avatarUrl = post.profiles?.avatar_url || '';
        const descText = post.description || '';

        let mediaHtml = post.media_type === 'video' 
            ? `<video src="${post.media_url}" autoplay loop muted playsinline></video>`
            : `<img src="${post.media_url}" alt="Post Image">`;

        // Notice the onclick="viewProfile('${post.user_id}')" wrapping the author row
        postDiv.innerHTML = `
            ${mediaHtml}
            <div class="post-overlay">
                <div class="post-info">
                    <div class="post-author-row" onclick="viewProfile('${post.user_id}')">
                        <div class="post-avatar" style="background-image: url('${avatarUrl}')"></div>
                        <div class="post-username">@${authorName}</div>
                    </div>
                    <div class="post-description">${descText}</div>
                </div>
                <div class="post-actions">
                    <button class="like-btn ${userHasLiked ? 'liked' : ''}" 
                            onclick="toggleLike('${post.id}', this, this.nextElementSibling)">
                        ❤
                    </button>
                    <span class="like-count">${likeCount}</span>
                </div>
            </div>
        `;
        
        feedContainer.appendChild(postDiv);
    });
}