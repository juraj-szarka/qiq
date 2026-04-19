// 1. Initialize Supabase
const supabaseUrl = 'https://etdkanqajrcxjytfxyyq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0ZGthbnFhanJjeGp5dGZ4eXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1OTIwNDYsImV4cCI6MjA5MjE2ODA0Nn0.-3KH6A6tfNvCeXPl7UIB92gL5BiO77ZrDEwlkbkZ1Ns';
const client = window.supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = null;
let userProfile = null;
let myFollowings = new Set(); 
let currentViewProfileId = null;

// --- App Initialization ---
async function initializeApp() {
    const { data: { session } } = await client.auth.getSession();
    await updateAuthState(session);
    
    loadFeed();

    client.auth.onAuthStateChange(async (event, session) => {
        if (event === 'INITIAL_SESSION') return; 
        await updateAuthState(session);
        if (event === 'SIGNED_IN') {
            switchTab('home'); 
        } else if (event === 'SIGNED_OUT') {
            switchTab('home');
        }
    });
}

async function updateAuthState(session) {
    currentUser = session?.user || null;
    
    if (currentUser) {
        await fetchMyFollowings();
        await loadUserProfile();
    } else {
        userProfile = null;
        myFollowings.clear();
    }
}

initializeApp();

// --- Tab Navigation System ---
function switchTab(tabId) {
    // 1. Update active styling on icons safely
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`nav-${tabId}`);
    if(activeBtn) activeBtn.classList.add('active');

    // 2. Hide ALL views (including the feed now)
    document.getElementById('feed').classList.add('hidden');
    hideModal('searchModal');
    hideModal('uploadModal');
    hideModal('profileModal');
    hideModal('authModal');
    hideModal('viewProfileModal');
    hideModal('singlePostModal');

    // 3. Show requested tab
    if (tabId === 'home') {
        document.getElementById('feed').classList.remove('hidden');
        loadFeed();
    } 
    else if (tabId === 'search') {
        showModal('searchModal');
    }
    else if (tabId === 'upload') {
        if (!currentUser) showModal('authModal');
        else showModal('uploadModal');
    } 
    else if (tabId === 'profile') {
        if (!currentUser) showModal('authModal');
        else showModal('profileModal');
    }
}


// --- STRICT MOUSE SCROLLING FOR NOTEBOOKS ---
let isScrolling = false;
document.getElementById('feed').addEventListener('wheel', (e) => {
    e.preventDefault(); 
    if (isScrolling) return; 
    
    isScrolling = true;
    const direction = e.deltaY > 0 ? 1 : -1;
    document.getElementById('feed').scrollBy({ top: direction * window.innerHeight, behavior: 'smooth' });
    
    setTimeout(() => { isScrolling = false; }, 600); 
}, { passive: false });


// --- Search System ---
async function searchUsers() {
    const query = document.getElementById('searchInput').value.trim();
    const container = document.getElementById('searchResults');
    
    if (!query) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = '<p style="text-align: center;">Searching...</p>';
    
    const { data, error } = await client.from('profiles')
        .select('id, username, avatar_url')
        .ilike('username', `%${query}%`)
        .limit(20);

    if (error) {
        container.innerHTML = '<p style="text-align: center;">Error searching.</p>';
        return;
    }

    container.innerHTML = "";
    
    if (!data || data.length === 0) {
        container.innerHTML = '<p style="text-align: center;">No users found.</p>';
        return;
    }

    data.forEach(user => {
        const row = document.createElement('div');
        row.className = 'list-user-row';
        row.onclick = () => { viewProfile(user.id); };
        row.innerHTML = `
            <div class="post-avatar" style="background-image: url('${user.avatar_url || ''}')"></div>
            <div>@${user.username || 'Anonymous'}</div>
        `;
        container.appendChild(row);
    });
}


// --- Follow System Logic ---
async function fetchMyFollowings() {
    if (!currentUser) return;
    const { data } = await client.from('follows').select('following_id').eq('follower_id', currentUser.id);
    if (data) {
        myFollowings = new Set(data.map(f => f.following_id));
    }
}

async function toggleFollow(event, targetUserId, isProfileView = false) {
    event.stopPropagation();
    if (!currentUser) return alert("Please login to follow!");

    const isFollowing = myFollowings.has(targetUserId);

    if (isFollowing) {
        await client.from('follows').delete().match({ follower_id: currentUser.id, following_id: targetUserId });
        myFollowings.delete(targetUserId);
    } else {
        await client.from('follows').insert([{ follower_id: currentUser.id, following_id: targetUserId }]);
        myFollowings.add(targetUserId);
    }

    if (isProfileView) {
        updateProfileFollowButton(targetUserId);
        viewProfile(targetUserId); 
    } else {
        loadFeed(); 
    }
}

async function getFollowStats(userId) {
    const { count: followers } = await client.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId);
    const { count: following } = await client.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId);
    return { followers: followers || 0, following: following || 0 };
}

async function showFollowList(type, userId) {
    showModal('listModal');
    const title = type === 'followers' ? 'Followers' : 'Following';
    document.getElementById('listTitle').innerText = title;
    const container = document.getElementById('listContainer');
    container.innerHTML = "Loading...";

    let query;
    if (type === 'followers') {
        query = client.from('follows').select('profiles!follows_follower_id_fkey(id, username, avatar_url)').eq('following_id', userId);
    } else {
        query = client.from('follows').select('profiles!follows_following_id_fkey(id, username, avatar_url)').eq('follower_id', userId);
    }

    const { data, error } = await query;

    if (error || !data.length) {
        return container.innerHTML = "<p>No users found.</p>";
    }

    container.innerHTML = "";
    data.forEach(item => {
        const user = item.profiles;
        const row = document.createElement('div');
        row.className = 'list-user-row';
        row.onclick = () => { hideModal('listModal'); viewProfile(user.id); };
        row.innerHTML = `
            <div class="post-avatar" style="background-image: url('${user.avatar_url || ''}')"></div>
            <div>@${user.username || 'Anonymous'}</div>
        `;
        container.appendChild(row);
    });
}

// --- Modal Controls ---
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

// --- Authentication ---
async function signUp() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const { error } = await client.auth.signUp({ email, password });
    if (error) alert(error.message);
    else alert("Check your email for confirmation!"); 
}

async function signIn() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
}

async function signOut() {
    await client.auth.signOut();
}

// --- Profile Management ---
async function loadUserProfile() {
    const { data, error } = await client.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    
    if (data) {
        userProfile = data;
        document.getElementById('username').value = data.username || '';
        document.getElementById('bio').value = data.bio || '';
        if (data.avatar_url) {
            document.getElementById('avatarPreview').style.backgroundImage = `url(${data.avatar_url})`;
        }
    }

    const stats = await getFollowStats(currentUser.id);
    document.getElementById('myFollowersCount').innerText = stats.followers;
    document.getElementById('myFollowingCount').innerText = stats.following;

    const grid = document.getElementById('myProfilePosts');
    grid.innerHTML = ""; 
    
    const { data: posts } = await client.from('posts').select(`*, profiles(username, avatar_url), likes(user_id)`).eq('user_id', currentUser.id).order('created_at', { ascending: false });
    
    if (posts) {
        posts.forEach(post => {
            const el = document.createElement(post.media_type === 'video' ? 'video' : 'img');
            el.src = post.media_url;
            if (post.media_type === 'video') el.muted = true;
            el.onclick = () => openSinglePost(post);
            grid.appendChild(el);
        });
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
        const { error: uploadError } = await client.storage.from('avatars').upload(fileName, avatarFile);
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
        setTimeout(() => statusText.innerText = "", 2000);
    }
}

// --- View Other Users Profile ---
async function viewProfile(userId) {
    if (currentUser && userId === currentUser.id) return switchTab('profile'); 

    currentViewProfileId = userId;
    showModal('viewProfileModal');
    
    document.getElementById('viewUsername').innerText = "Loading...";
    document.getElementById('viewBio').innerText = "";
    document.getElementById('viewAvatar').style.backgroundImage = "none";
    const grid = document.getElementById('viewProfilePosts');
    grid.innerHTML = ""; 

    const { data: profile } = await client.from('profiles').select('*').eq('id', userId).single();
    if (profile) {
        document.getElementById('viewUsername').innerText = "@" + (profile.username || "Anonymous");
        document.getElementById('viewBio').innerText = profile.bio || "";
        if (profile.avatar_url) {
            document.getElementById('viewAvatar').style.backgroundImage = `url(${profile.avatar_url})`;
        }
    }

    const stats = await getFollowStats(userId);
    document.getElementById('viewFollowersCount').innerText = stats.followers;
    document.getElementById('viewFollowingCount').innerText = stats.following;

    updateProfileFollowButton(userId);

    const { data: posts } = await client.from('posts').select(`*, profiles(username, avatar_url), likes(user_id)`).eq('user_id', userId).order('created_at', { ascending: false });
    if (posts) {
        posts.forEach(post => {
            const el = document.createElement(post.media_type === 'video' ? 'video' : 'img');
            el.src = post.media_url;
            if (post.media_type === 'video') el.muted = true; 
            el.onclick = () => openSinglePost(post);
            grid.appendChild(el);
        });
    }
}

function updateProfileFollowButton(userId) {
    const btn = document.getElementById('profileFollowBtn');
    if (!currentUser) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = 'inline-block';
    
    if (myFollowings.has(userId)) {
        btn.innerText = "Following";
        btn.classList.add('following');
    } else {
        btn.innerText = "Follow";
        btn.classList.remove('following');
    }
}

// --- Upload Media ---
async function uploadMedia() {
    const fileInput = document.getElementById('mediaInput');
    const file = fileInput.files[0];
    if (!file) return alert("Select a file");

    const statusText = document.getElementById('uploadStatus');
    statusText.innerText = "Processing upload..."; 

    const type = file.type.startsWith('video/') ? 'video' : 'image';
    await processUpload(file, statusText, type);
}

async function processUpload(file, statusText, type) {
    const fileName = `${Date.now()}_${file.name}`;
    const description = document.getElementById('postDescription').value;

    const { error: storageError } = await client.storage.from('media').upload(fileName, file);
    
    if (storageError) {
        return statusText.innerText = "Upload Error: " + storageError.message;
    }

    const { data: publicUrlData } = client.storage.from('media').getPublicUrl(fileName);

    const { error: dbError } = await client.from('posts').insert([
        { user_id: currentUser.id, media_url: publicUrlData.publicUrl, media_type: type, description: description }
    ]);

    if (dbError) {
        statusText.innerText = "DB Error: " + dbError.message;
    } else {
        statusText.innerText = "Uploaded successfully!";
        document.getElementById('postDescription').value = ""; 
        document.getElementById('mediaInput').value = ""; 
        setTimeout(() => {
            statusText.innerText = "";
            switchTab('home'); // Send user back to feed after upload
        }, 1000);
        if(currentUser) loadUserProfile();
    }
}

// --- Deletion Logic ---
function togglePostMenu(postId) {
    const menu = document.getElementById(`menu-${postId}`);
    if (menu) menu.classList.toggle('hidden');
}

async function deletePost(event, postId, postUserId) {
    event.stopPropagation(); // Prevents click from opening the post if triggered from profile view

    if (!currentUser || currentUser.id !== postUserId) {
        return alert("You can only delete your own posts.");
    }

    if (!confirm("Are you sure you want to delete this post?")) return;

    const { error } = await client.from('posts').delete().eq('id', postId).eq('user_id', currentUser.id);
    
    if (error) {
        alert("Failed to delete: " + error.message);
        return;
    }

    const postElementInFeed = document.getElementById(`post-container-${postId}`);
    if (postElementInFeed) postElementInFeed.remove();

    hideModal('singlePostModal'); 
    if (currentUser) loadUserProfile(); 
}

// --- Likes & Rendering Posts ---
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

function createPostElement(post) {
    const postDiv = document.createElement('div');
    postDiv.className = 'post';
    postDiv.id = `post-container-${post.id}`;

    const userHasLiked = currentUser && post.likes.some(like => like.user_id === currentUser.id);
    const likeCount = post.likes.length;
    const authorName = post.profiles?.username || 'Anonymous';
    const avatarUrl = post.profiles?.avatar_url || '';
    
    let mediaHtml = post.media_type === 'video' 
        ? `<video src="${post.media_url}" autoplay loop playsinline></video>`
        : `<img src="${post.media_url}" alt="Post Image">`;

    let followBtnHtml = '';
    if (currentUser && post.user_id !== currentUser.id) {
        const isFollowing = myFollowings.has(post.user_id);
        followBtnHtml = `<button class="feed-follow-btn ${isFollowing ? 'following' : ''}" onclick="toggleFollow(event, '${post.user_id}')">${isFollowing ? 'Following' : 'Follow'}</button>`;
    }

    // Fixed hidden menu behavior
    let optionsMenuHtml = '';
    if (currentUser && post.user_id === currentUser.id) {
        optionsMenuHtml = `
            <button class="more-options-btn material-icons" onclick="togglePostMenu('${post.id}')">more_vert</button>
            <div id="menu-${post.id}" class="post-menu hidden">
                <button onclick="deletePost(event, '${post.id}', '${post.user_id}')">Delete Post</button>
            </div>
        `;
    }

    postDiv.innerHTML = `
        ${optionsMenuHtml}
        ${mediaHtml}
        <div class="post-overlay">
            <div class="post-info">
                <div class="post-author-row" onclick="viewProfile('${post.user_id}')">
                    <div class="post-avatar" style="background-image: url('${avatarUrl}')"></div>
                    <div class="post-username">@${authorName}</div>
                    ${followBtnHtml} 
                </div>
                <div class="post-description">${post.description || ''}</div>
            </div>
            <div class="post-actions">
                <button class="like-btn ${userHasLiked ? 'liked' : ''}" 
                        onclick="toggleLike('${post.id}', this, this.nextElementSibling)">❤</button>
                <span class="like-count">${likeCount}</span>
            </div>
        </div>
    `;
    
    return postDiv;
}

function openSinglePost(post) {
    const container = document.getElementById('singlePostContainer');
    container.innerHTML = "";
    container.appendChild(createPostElement(post));
    showModal('singlePostModal');
}

async function loadFeed() {
    const feedContainer = document.getElementById('feed');
    feedContainer.innerHTML = ''; 

    const { data: posts, error } = await client
        .from('posts')
        .select(`*, profiles(username, avatar_url), likes(user_id)`)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) return console.error(error);

    posts.forEach(post => {
        feedContainer.appendChild(createPostElement(post));
    });
}