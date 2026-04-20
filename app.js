// 1. Initialize Supabase
const supabaseUrl = 'https://etdkanqajrcxjytfxyyq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0ZGthbnFhanJjeGp5dGZ4eXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1OTIwNDYsImV4cCI6MjA5MjE2ODA0Nn0.-3KH6A6tfNvCeXPl7UIB92gL5BiO77ZrDEwlkbkZ1Ns';
const client = window.supabase.createClient(supabaseUrl, supabaseKey);

let currentUser = null;
let userProfile = null;
let myFollowings = new Set(); 
let currentViewProfileId = null;

let currentFeedMode = 'foryou'; // Can be 'foryou' or 'following'

// --- Algorithm: View Tracking System ---
// --- Algorithm: View Tracking System ---
const viewedPosts = new Set();
const viewTimers = new Map(); // Tracks how long a user stays on a post

// --- Video Playback & Focus Management ---
const videoObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        const video = entry.target;
        const isHidden = video.closest('.hidden') !== null;
        
        if (entry.isIntersecting && !isHidden) {
            video.play().catch(e => console.log("Autoplay prevented:", e));
        } else {
            video.pause();
            video.currentTime = 0; // Rewind to start when scrolled away
        }
    });
}, { threshold: 0.6 });

// 1. Play/Pause with Spacebar
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        // Prevent spacebar from triggering if typing in a comment/search
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        e.preventDefault();
        
        document.querySelectorAll('.post video').forEach(video => {
            // Check if video is visible in the DOM
            if (video.offsetParent !== null) {
                const rect = video.getBoundingClientRect();
                // Check if it's currently focused in the viewport
                if (rect.top >= -window.innerHeight * 0.5 && rect.bottom <= window.innerHeight * 1.5) {
                    if (video.paused) video.play().catch(e => {});
                    else video.pause();
                }
            }
        });
    }
});

// 2. Pause when switching browser tabs or minimizing the window
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        document.querySelectorAll('video').forEach(v => v.pause());
    } else {
        document.querySelectorAll('.post video').forEach(video => {
            if (video.offsetParent !== null) {
                const rect = video.getBoundingClientRect();
                if (rect.top >= -window.innerHeight * 0.5 && rect.bottom <= window.innerHeight * 1.5) {
                    video.play().catch(e => {});
                }
            }
        });
    }
});

const feedObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        const postId = entry.target.id.replace('post-container-', '');
        
        if (entry.isIntersecting) {
            // Start a 1-second timer every time the post comes on screen
            const timer = setTimeout(() => {
                
                // 1. Optimistic UI Update (Changes the number on screen instantly)
                const viewCountElement = document.getElementById(`view-count-${postId}`);
                if (viewCountElement) {
                    const currentViews = parseInt(viewCountElement.innerText) || 0;
                    viewCountElement.innerText = currentViews + 1;
                }
                
                // 2. Send to Database in the background
                const userIdToPass = currentUser ? currentUser.id : null;
                client.rpc('record_post_view', { p_user_id: userIdToPass, p_post_id: postId })
                    .then(({ error }) => {
                        if (error) console.error("DB View Error:", error.message);
                    });
                
            }, 1000); // 1000ms = 1 second
            
            viewTimers.set(postId, timer);
        } else {
            // If they scroll away before 1 second, cancel the timer
            if (viewTimers.has(postId)) {
                clearTimeout(viewTimers.get(postId));
                viewTimers.delete(postId);
            }
        }
    });
}, { threshold: 0.6 }); // Requires 60% of the post to be visible

function switchFeedTab(mode) {
    currentFeedMode = mode;
    document.querySelectorAll('.top-nav-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${mode}`).classList.add('active');
    loadFeed(); // Reload the feed with the new mode
}

// --- App Initialization ---
async function initializeApp() {
    const { data: { session } } = await client.auth.getSession();
    await updateAuthState(session);
    
    loadFeed();

    client.auth.onAuthStateChange(async (event, session) => {
        if (event === 'INITIAL_SESSION') return; 
        await updateAuthState(session);
        if (event === 'SIGNED_IN') {
            hideModal('authModal');
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
        
        // Clear previous profile data from the DOM to prevent it from showing on next login
        document.getElementById('username').value = '';
        if(document.getElementById('displayName')) document.getElementById('displayName').value = '';
        document.getElementById('bio').value = '';
        document.getElementById('avatarPreview').style.backgroundImage = 'none';
        document.getElementById('myFollowersCount').innerText = '0';
        document.getElementById('myFollowingCount').innerText = '0';
        document.getElementById('myProfilePosts').innerHTML = '';
        
        // Reset auth view to login by default
        toggleAuthView('login');
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
        document.getElementById('topFeedNav').classList.remove('hidden'); // Show top tabs
        loadFeed();
    } else {
        document.getElementById('topFeedNav').classList.add('hidden'); // Hide on other pages
        // ... rest of your if/else logic ...
    
        if (tabId === 'search') {
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
    
    // FIXED: Removed 'email' from the select and search query. 
    // It now only searches the username column to prevent the 400 Bad Request.
    const { data, error } = await client.from('profiles')
        .select('id, username, avatar_url')
        .ilike('username', `%${query}%`)
        .limit(20);

    if (error) {
        console.error("Search error:", error);
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

function closeSinglePostModal() {
    hideModal('singlePostModal');
    const container = document.getElementById('singlePostContainer');
    const video = container.querySelector('video');
    if (video) video.pause(); // Stop video before clearing
    container.innerHTML = ""; // Clear to prevent duplicate DOM IDs
}

function closeViewProfileModal() {
    hideModal('viewProfileModal');
    // Resume the feed video if returning to the home tab
    if (document.getElementById('feed').offsetParent !== null) {
        document.querySelectorAll('#feed video').forEach(video => {
            const rect = video.getBoundingClientRect();
            if (rect.top >= -window.innerHeight * 0.5 && rect.bottom <= window.innerHeight * 1.5) {
                video.play().catch(e => {});
            }
        });
    }
}

// --- Authentication ---
function toggleAuthView(view) {
    if (view === 'register') {
        document.getElementById('loginView').classList.add('hidden');
        document.getElementById('registerView').classList.remove('hidden');
    } else {
        document.getElementById('registerView').classList.add('hidden');
        document.getElementById('loginView').classList.remove('hidden');
    }
}

// Update the signUp function in app.js
async function signUp() {
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;

    if (!username) return alert("Username is required!");

    const { data, error } = await client.auth.signUp({ email, password });
    
    if (error) {
        alert(error.message);
    } else if (data.user) {
        // Create the profile entry with the chosen username immediately
        const { error: profileError } = await client.from('profiles').upsert({
            id: data.user.id,
            username: username
        });

        if (profileError) console.error("Profile creation error:", profileError);
        
        alert("Check your email for confirmation!"); 
    }
}

async function signIn() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
        alert(error.message);
    } else {
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginPassword').value = '';
    }
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
    
    const { data: posts } = await client.from('posts').select(`*, profiles(username, avatar_url), likes(user_id), comments(id)`).eq('user_id', currentUser.id).order('created_at', { ascending: false });

    // Inside loadUserProfile()
    if (posts) {
        posts.forEach(post => {
            const wrapper = document.createElement('div');
            wrapper.className = 'profile-grid-item';
            wrapper.onclick = () => openSinglePost(post);

            // Create the media element
            const mediaHtml = post.media_type === 'video' 
                ? `<video src="${post.media_url}" muted playsinline></video>`
                : `<img src="${post.media_url}">`;

            // Inject media and the view count overlay
            wrapper.innerHTML = `
                ${mediaHtml}
                <div class="grid-view-count">
                    <span class="material-icons">visibility</span>
                    ${post.views || 0}
                </div>
            `;
            grid.appendChild(wrapper);
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

    document.querySelectorAll('#feed video').forEach(v => v.pause());

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
            const wrapper = document.createElement('div');
            wrapper.className = 'profile-grid-item';
            wrapper.onclick = () => openSinglePost(post);

            const mediaHtml = post.media_type === 'video' 
                ? `<video src="${post.media_url}" muted playsinline></video>`
                : `<img src="${post.media_url}">`;

            wrapper.innerHTML = `
                ${mediaHtml}
                <div class="grid-view-count">
                    <span class="material-icons">visibility</span>
                    ${post.views || 0}
                </div>
            `;
            grid.appendChild(wrapper);
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

    // ALGORITHM FEATURE: Extract hashtags from the caption
    const hashtags = description.match(/#[\w]+/g) || [];
    const tagsArray = hashtags.map(t => t.replace('#', '').toLowerCase());

    const { error: storageError } = await client.storage.from('media').upload(fileName, file);
    
    if (storageError) {
        return statusText.innerText = "Upload Error: " + storageError.message;
    }

    const { data: publicUrlData } = client.storage.from('media').getPublicUrl(fileName);

    const { error: dbError } = await client.from('posts').insert([
        { 
            user_id: currentUser.id, 
            media_url: publicUrlData.publicUrl, 
            media_type: type, 
            description: description,
            tags: tagsArray // Save the tags to the database
        }
    ]);

    if (dbError) {
        statusText.innerText = "DB Error: " + dbError.message;
    } else {
        statusText.innerText = "Uploaded successfully!";
        document.getElementById('postDescription').value = ""; 
        document.getElementById('mediaInput').value = ""; 
        setTimeout(() => {
            statusText.innerText = "";
            switchTab('home'); 
        }, 1000);
        if(currentUser) loadUserProfile();
    }
}

// --- Deletion Logic ---
function togglePostMenu(event) {
    event.stopPropagation(); // Prevents click from opening the post profile
    
    // Finds the exact menu next to the specific button you clicked
    const menu = event.target.nextElementSibling;
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

// --- Double Tap to Like ---
window.handleDoubleTap = function(postId) {
    if (!currentUser) return alert("Please login to like posts!");
    const btn = document.getElementById(`like-btn-${postId}`);
    const count = document.getElementById(`like-count-${postId}`);
    
    // Simply triggers the like toggle every time you double tap
    if (btn) {
        toggleLike(postId, btn, count);
    }
};

function createPostElement(post) {
    const postDiv = document.createElement('div');
    postDiv.className = 'post';
    postDiv.id = `post-container-${post.id}`;

    const userHasLiked = currentUser && post.likes.some(like => like.user_id === currentUser.id);
    const likeCount = post.likes.length;
    const commentCount = post.comments ? post.comments.length : 0;
    const authorName = post.profiles?.username || 'Anonymous';
    const avatarUrl = post.profiles?.avatar_url || '';
    
    // 1. Removed the native ondblclick from the media elements
    let mediaHtml = post.media_type === 'video' 
        ? `<video src="${post.media_url}" loop playsinline></video>`
        : `<img src="${post.media_url}" alt="Post Image">`;
    let followBtnHtml = '';
    // 2. FIXED BUG: post.user_id !== post.user_id changed to currentUser.id !== post.user_id
    if (currentUser && currentUser.id !== post.user_id) {
        const isFollowing = myFollowings.has(post.user_id);
        followBtnHtml = `<button class="feed-follow-btn ${isFollowing ? 'following' : ''}" onclick="toggleFollow(event, '${post.user_id}')">${isFollowing ? 'Following' : 'Follow'}</button>`;
    }

    let optionsMenuHtml = '';
    if (currentUser && post.user_id === currentUser.id) {
        optionsMenuHtml = `
            <button class="more-options-btn material-icons" onclick="togglePostMenu(event)">more_vert</button>
            <div class="post-menu hidden">
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
                <button id="like-btn-${post.id}" class="like-btn ${userHasLiked ? 'liked' : ''}" 
                        onclick="toggleLike('${post.id}', this, this.nextElementSibling)">❤</button>
                <span id="like-count-${post.id}" class="like-count">${likeCount}</span>
                
                <button class="comment-btn material-icons" onclick="openComments('${post.id}')">chat</button>
                <span id="comment-count-${post.id}" class="like-count">${commentCount}</span>

                <button class="view-btn material-icons" style="margin-top: 15px;">visibility</button>
                <span id="view-count-${post.id}" class="like-count">${post.views || 0}</span>
            </div>
        </div>
    `;
    
// --- 3. NEW CUSTOM TAP LOGIC (Single = Play/Pause, Double = Like) ---
    let clickTimer = null;
    
    postDiv.addEventListener('click', (e) => {
        // Ignore clicks on specific UI buttons
        if (e.target.closest('.post-actions') || e.target.closest('.post-info') || e.target.closest('.more-options-btn')) {
            return; 
        }

        const video = postDiv.querySelector('video');

        // If no timer exists, this is the first tap
        if (clickTimer === null) {
            clickTimer = setTimeout(() => {
                // Timer finished! It was just a single tap.
                clickTimer = null;
                
                // --- SINGLE TAP: Play / Pause ---
                if (video) {
                    if (video.paused) {
                        video.play().catch(err => console.log("Play prevented by browser:", err));
                    } else {
                        video.pause();
                    }
                }
            }, 250); // Wait 250ms to see if a second tap happens
        } 
        else {
            // A timer is running, meaning this is the SECOND tap!
            clearTimeout(clickTimer);
            clickTimer = null;
            
            // --- DOUBLE TAP: Like ---
            window.handleDoubleTap(post.id);
            e.preventDefault(); 
            
            // Heart Animation Logic
            const heart = document.createElement('span');
            heart.classList.add('material-icons', 'tap-heart');
            heart.innerText = 'favorite'; 
            postDiv.appendChild(heart);

            setTimeout(() => {
                heart.remove();
            }, 800);
        }
    });

    // Attach the video element to the playback observer
    const videoElement = postDiv.querySelector('video');
    if (videoElement) {
        videoObserver.observe(videoElement);
    }

    return postDiv;
}

function openSinglePost(post) {
    // Pause all background feed videos
    document.querySelectorAll('.post video').forEach(v => v.pause());

    const container = document.getElementById('singlePostContainer');
    container.innerHTML = "";
    
    const postElement = createPostElement(post);
    container.appendChild(postElement);
    
    showModal('singlePostModal');

    // Force play the video specifically for the modal
    const video = postElement.querySelector('video');
    if (video) {
        // Small delay ensures the modal is fully visible to the browser before playing
        setTimeout(() => {
            video.play().catch(e => console.log("Modal autoplay prevented:", e));
        }, 100);
    }
}

async function loadFeed() {
    const feedContainer = document.getElementById('feed');
    feedContainer.innerHTML = '<div style="color:white; text-align:center; padding-top:50vh;">Loading...</div>'; 

    let query = client.from('posts').select(`*, profiles(username, avatar_url), likes(user_id), comments(id), engagement_score`);

    // --- 1. Filter by Following if needed ---
    if (currentFeedMode === 'following') {
        if (!currentUser) return feedContainer.innerHTML = '<div style="color:white; text-align:center; padding-top:50vh;">Please login to see followed accounts.</div>';
        if (myFollowings.size === 0) return feedContainer.innerHTML = '<div style="color:white; text-align:center; padding-top:50vh;">You are not following anyone yet.</div>';
        
        // Only fetch posts from people we follow
        query = query.in('user_id', Array.from(myFollowings));
    }

    // Fetch the posts
    const { data: posts, error } = await query.order('engagement_score', { ascending: false }).limit(60);
    if (error || !posts) return console.error("Feed error:", error);

    let finalPosts = posts;

    // --- 2. For You Page Algorithm & Viewed Separation ---
    let unseenPosts = [];
    let seenPosts = [];

    if (currentUser) {
        // A. Fetch all post IDs the user has already viewed
        const { data: viewedData } = await client.from('post_views').select('post_id').eq('user_id', currentUser.id);
        const viewedIds = new Set(viewedData ? viewedData.map(v => v.post_id) : []);

        // B. Fetch user tag preferences for the For You algorithm
        const { data: userLikes, error: likesError } = await client.from('likes').select('posts(tags)').eq('user_id', currentUser.id).limit(20);
        const tagPreferences = {};
        
        if (userLikes && !likesError) {
            userLikes.forEach(like => {
                // Safely handle how Supabase returns the 'posts' relation
                const likedPost = Array.isArray(like.posts) ? like.posts[0] : like.posts;
                
                // Only loop if tags actually exist and is an array
                if (likedPost && Array.isArray(likedPost.tags)) {
                    likedPost.tags.forEach(tag => { 
                        tagPreferences[tag] = (tagPreferences[tag] || 0) + 1; 
                    });
                }
            });
        }
        // C. Apply Algorithmic Tag Boost & Separate Seen vs Unseen
        posts.forEach(post => {
            let tagScore = 0;
            (post.tags || []).forEach(tag => { if (tagPreferences[tag]) tagScore += tagPreferences[tag]; });
            post.calculated_score = post.engagement_score + (tagScore * 10);

            // Separate them
            if (viewedIds.has(post.id)) {
                seenPosts.push(post);
            } else {
                unseenPosts.push(post);
            }
        });

        // D. Sort both arrays highest to lowest by our new calculated score
        unseenPosts.sort((a, b) => b.calculated_score - a.calculated_score);
        seenPosts.sort((a, b) => b.calculated_score - a.calculated_score);
    } else {
        // If logged out, just show everything sorted by engagement score
        unseenPosts = posts; 
    }

    feedContainer.innerHTML = ''; // Clear loading text
    feedContainer.scrollTop = 0;  // NEW: Reset scroll so the first item registers accurately

    // --- 3. Render the Feed ---
    
    // Render Unseen videos first
    unseenPosts.forEach(post => {
        const postElement = createPostElement(post);
        feedContainer.appendChild(postElement);
        feedObserver.observe(postElement); // NEW: Observe AFTER it is in the DOM
    });

    // If they have seen videos, show the "Caught Up" divider, then show the seen videos
    if (currentUser && seenPosts.length > 0) {
        
        if (unseenPosts.length > 0) {
            const divider = document.createElement('div');
            divider.className = 'caught-up-divider';
            divider.innerHTML = `
                <span class="material-icons">check_circle</span>
                <h2>You're all caught up!</h2>
                <p>You've seen all new posts. Here are some older ones.</p>
            `;
            feedContainer.appendChild(divider);
        }

        // Render the already viewed videos below
// ... [Previous loadFeed code rendering seenPosts] ...
        seenPosts.forEach(post => {
            const postElement = createPostElement(post);
            feedContainer.appendChild(postElement);
            feedObserver.observe(postElement); 
        });
    }

    // NEW: Force the first video in the feed to play!
    setTimeout(() => {
        const firstVideo = feedContainer.querySelector('.post video');
        if (firstVideo) {
            firstVideo.play().catch(e => {
                console.log("Browser blocked unmuted autoplay. User must interact first.", e);
            });
        }
    }, 200); 
} // <-- This is the end of the loadFeed() function}

// --- Comment System ---
let currentCommentPostId = null;

async function openComments(postId) {
    currentCommentPostId = postId;
    showModal('commentsModal');
    document.getElementById('newCommentInput').value = '';
    
    // Attach the current post ID to the post button
    document.getElementById('postCommentBtn').onclick = () => postComment(postId);
    
    await loadComments(postId);
}

async function loadComments(postId) {
    const list = document.getElementById('commentsList');
    list.innerHTML = '<p style="text-align:center; color: #aaa;">Loading comments...</p>';

    // Fetch comments and join with the profiles table to get usernames/avatars
    const { data, error } = await client.from('comments')
        .select('*, profiles(username, avatar_url)')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });

    if (error) return list.innerHTML = '<p style="text-align:center;">Error loading comments.</p>';

    if (!data || data.length === 0) {
        return list.innerHTML = '<p style="text-align:center; color:#aaa; margin-top: 20px;">No comments yet. Be the first!</p>';
    }

    list.innerHTML = ''; // Clear loading text
    data.forEach(comment => {
        const row = document.createElement('div');
        row.className = 'comment-row';
        row.innerHTML = `
            <div class="post-avatar" style="background-image: url('${comment.profiles?.avatar_url || ''}'); width: 35px; height: 35px;"></div>
            <div class="comment-content">
                <div class="comment-username" onclick="hideModal('commentsModal'); viewProfile('${comment.user_id}')" style="cursor: pointer;">
                    @${comment.profiles?.username || 'Anonymous'}
                </div>
                <div class="comment-text">${comment.content}</div>
            </div>
        `;
        list.appendChild(row);
    });
    
    // Auto-scroll to the newest comment at the bottom
    list.scrollTop = list.scrollHeight;
}

async function postComment(postId) {
    if (!currentUser) return alert('Please login to comment!');
    
    const input = document.getElementById('newCommentInput');
    const content = input.value.trim();
    if (!content) return;

    input.disabled = true; // Prevent spam clicking

    const { error } = await client.from('comments').insert([
        { post_id: postId, user_id: currentUser.id, content: content }
    ]);

    input.disabled = false;

    if (error) {
        alert('Error posting comment: ' + error.message);
    } else {
        input.value = '';
        await loadComments(postId); // Refresh the list

        // NEW: Instantly update the count on the feed!
        const countElement = document.getElementById(`comment-count-${postId}`);
        if (countElement) {
            countElement.innerText = parseInt(countElement.innerText) + 1;
        }
    }
}

// --- DM & Notification System ---
let messageInterval = null;
let currentChatUserId = null;

// Attach this to updateAuthState to start/stop checking messages
const originalUpdateAuthState = updateAuthState;
updateAuthState = async function(session) {
    await originalUpdateAuthState(session);
    if (currentUser) {
        pollMessages();
        if(!messageInterval) messageInterval = setInterval(pollMessages, 3000); // Check every 3 seconds
    } else {
        if(messageInterval) clearInterval(messageInterval);
    }
}

// Update your switchTab function to handle the new messages tab
// Update your switchTab function to handle the new messages tab AND close the chat
const originalSwitchTab = switchTab;
switchTab = function(tabId) {
    originalSwitchTab(tabId);
    hideModal('messagesModal'); // Ensure messages hide when leaving
    hideModal('chatModal');     // NEW: Ensure the open chat closes too!
    currentChatUserId = null;   // NEW: Reset the chat tracking
    
    if (tabId === 'messages') {
        if (!currentUser) showModal('authModal');
        else {
            showModal('messagesModal');
            loadInbox();
        }
    }
}

// Update your viewProfile function to show the Message button
const originalViewProfile = viewProfile;
viewProfile = async function(userId) {
    await originalViewProfile(userId);
    const msgBtn = document.getElementById('profileMessageBtn');
    if (msgBtn) {
        if (currentUser && currentUser.id !== userId) {
            msgBtn.style.display = 'inline-block';
        } else {
            msgBtn.style.display = 'none';
        }
    }
}

async function pollMessages() {
    if (!currentUser) return;
    
    // 1. Check for unread notification count
    const { count } = await client.from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('receiver_id', currentUser.id)
        .eq('is_read', false);
    
    const badge = document.getElementById('unreadBadge');
    if (badge) {
        if (count > 0) {
            badge.innerText = count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    // 2. Auto-refresh chat if currently open
    if (currentChatUserId) loadChatMessages(true);
}

async function loadInbox() {
    const container = document.getElementById('inboxList');
    container.innerHTML = '<p style="text-align: center;">Loading...</p>';

    // Fetch all messages to build the inbox UI
    const { data, error } = await client.from('messages')
        .select(`
            id, content, created_at, is_read, sender_id, receiver_id,
            sender:profiles!messages_sender_id_fkey(id, username, avatar_url),
            receiver:profiles!messages_receiver_id_fkey(id, username, avatar_url)
        `)
        .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
        .order('created_at', { ascending: false });
    
    if (error) return container.innerHTML = '<p style="text-align: center;">Error loading inbox.</p>';

    const threads = {};
    data.forEach(msg => {
        const otherUser = msg.sender_id === currentUser.id ? msg.receiver : msg.sender;
        if (!threads[otherUser.id]) {
            threads[otherUser.id] = {
                user: otherUser,
                lastMsg: msg.content,
                unread: msg.receiver_id === currentUser.id && !msg.is_read
            };
        }
    });

    container.innerHTML = '';
    const threadKeys = Object.keys(threads);
    if(threadKeys.length === 0) return container.innerHTML = '<p style="text-align: center; color: #aaa;">No messages yet.</p>';

    threadKeys.forEach(userId => {
        const thread = threads[userId];
        const row = document.createElement('div');
        row.className = 'list-user-row';
        row.onclick = () => openChat(userId);
        row.innerHTML = `
            <div class="post-avatar" style="background-image: url('${thread.user.avatar_url || ''}')"></div>
            <div style="flex-grow: 1;">
                <div style="font-weight: bold;">@${thread.user.username}</div>
                <div style="font-size: 13px; color: ${thread.unread ? '#fff' : '#aaa'}; font-weight: ${thread.unread ? 'bold' : 'normal'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;">
                    ${thread.lastMsg}
                </div>
            </div>
            ${thread.unread ? '<div style="width: 10px; height: 10px; background: #ff0050; border-radius: 50%;"></div>' : ''}
        `;
        container.appendChild(row);
    });
}

async function openChat(userId) {
    currentChatUserId = userId;
    showModal('chatModal');
    
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '<p style="text-align:center;">Loading...</p>';

    // Load header details
    const { data: profile } = await client.from('profiles').select('username, avatar_url').eq('id', userId).single();
    if (profile) {
        document.getElementById('chatUsername').innerText = '@' + profile.username;
        document.getElementById('chatAvatar').style.backgroundImage = profile.avatar_url ? `url(${profile.avatar_url})` : 'none';
    }

    // Mark as read immediately when opening
    await client.from('messages').update({ is_read: true }).eq('sender_id', userId).eq('receiver_id', currentUser.id);
    pollMessages(); 

    await loadChatMessages();
}

function closeChat() {
    hideModal('chatModal');
    currentChatUserId = null;
    if(!document.getElementById('messagesModal').classList.contains('hidden')) loadInbox();
}

async function loadChatMessages(isSilentRefresh = false) {
    if (!currentChatUserId) return;
    const container = document.getElementById('chatMessages');
    
    // Check if user has scrolled up; if so, don't force them back down on silent refresh
    const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 50;

    const { data, error } = await client.from('messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${currentChatUserId}),and(sender_id.eq.${currentChatUserId},receiver_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true });

    if (error && !isSilentRefresh) return container.innerHTML = '<p style="text-align:center;">Error loading messages.</p>';

    container.innerHTML = '';
    data.forEach(msg => {
        const div = document.createElement('div');
        div.className = `chat-msg ${msg.sender_id === currentUser.id ? 'sent' : 'received'}`;
        div.innerText = msg.content;
        container.appendChild(div);
    });

    if (!isSilentRefresh || isScrolledToBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

async function sendChatMessage() {
    if (!currentUser || !currentChatUserId) return;
    const input = document.getElementById('chatInput');
    const content = input.value.trim();
    if (!content) return;

    input.value = ''; 
    input.style.height = 'auto'; // NEW: Reset the height back to 1 row after sending!
    
    // Optimistic UI Append to feel instant
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = `chat-msg sent`;
    div.innerText = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    const { error } = await client.from('messages').insert([
        { sender_id: currentUser.id, receiver_id: currentChatUserId, content: content }
    ]);
    if (error) alert("Failed to send message: " + error.message);
}

// --- Chat Input Auto-Expand & Shift+Enter Logic ---
const chatInputField = document.getElementById('chatInput');

if (chatInputField) {
    // Handle Enter vs Shift+Enter
    chatInputField.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Prevents it from creating a new line
            sendChatMessage();  // Sends the message instead
        }
    });

    // Handle Auto-Expanding Height
    chatInputField.addEventListener('input', function() {
        this.style.height = 'auto'; // Reset height to recalculate
        this.style.height = (this.scrollHeight) + 'px'; // Expand to fit content
    });
}