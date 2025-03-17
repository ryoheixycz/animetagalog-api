const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // This ensures binding to all network interfaces

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Increased limit for bulk uploads
app.use(express.static('public'));

// Data file paths - use environment variable for data directory in production
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const EPISODES_FILE = path.join(DATA_DIR, 'episodes.json');
const CUSTOM_ANIME_FILE = path.join(DATA_DIR, 'custom_anime.json');

// Create data directory if it doesn't exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize data files if they don't exist
const initializeDataFile = (filePath, initialData) => {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2));
    }
};

initializeDataFile(EPISODES_FILE, []);
initializeDataFile(CUSTOM_ANIME_FILE, []);

// Helper functions to read and write data
const readData = (filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        return [];
    }
};

const writeData = (filePath, data) => {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error writing to ${filePath}:`, error);
        return false;
    }
};

// AniList GraphQL API
const ANILIST_API = 'https://graphql.anilist.co';

// GraphQL query to get anime details
const getAnimeQuery = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title {
      english
      romaji
      native
    }
    description
    genres
    coverImage {
      large
    }
    bannerImage
    averageScore
    popularity
    episodes
    duration
    status
    startDate {
      year
      month
      day
    }
    endDate {
      year
      month
      day
    }
    season
    studios {
      nodes {
        name
      }
    }
    countryOfOrigin
    isAdult
  }
}
`;

const searchAnimeQuery = `
query ($search: String) {
  Page(page: 1, perPage: 10) {
    media(search: $search, type: ANIME) {
      id
      title {
        english
        romaji
        native
      }
      description
      genres
      coverImage {
        large
      }
      bannerImage
      averageScore
      popularity
      episodes
      duration
      status
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      season
      studios {
        nodes {
          name
        }
      }
      countryOfOrigin
      isAdult
    }
  }
}
`;

// Format anime data from AniList
const formatAnimeData = (anilistData) => {
  const media = anilistData.data.Media;
  
  // Format date
  const formatDate = (dateObj) => {
    if (!dateObj || !dateObj.year) return null;
    return `${dateObj.year}-${dateObj.month?.toString().padStart(2, '0') || '01'}-${dateObj.day?.toString().padStart(2, '0') || '01'}`;
  };
  
  return {
    id: media.id.toString(),
    title: media.title.english || media.title.romaji,
    titleRomaji: media.title.romaji,
    titleNative: media.title.native,
    description: media.description?.replace(/<br>/g, '\n').replace(/<\/?[^>]+(>|$)/g, "") || "",
    genres: media.genres || [],
    thumbnail: media.coverImage?.large || "",
    banner: media.bannerImage || "",
    rating: media.averageScore / 10 || 0,
    popularity: media.popularity || 0,
    episodeCount: media.episodes?.toString() || "Unknown",
    duration: media.duration?.toString() || "Unknown",
    status: media.status || "Unknown",
    startDate: formatDate(media.startDate),
    endDate: formatDate(media.endDate),
    season: media.season || "Unknown",
    country: media.countryOfOrigin || "Unknown",
    isAdult: media.isAdult || false,
    studios: media.studios?.nodes?.map(studio => studio.name) || [],
    dateAdded: new Date().toISOString()
  };
};

// Format search results from AniList
const formatSearchResults = (anilistData) => {
  return anilistData.data.Page.media.map(media => {
    // Format date
    const formatDate = (dateObj) => {
      if (!dateObj || !dateObj.year) return null;
      return `${dateObj.year}-${dateObj.month?.toString().padStart(2, '0') || '01'}-${dateObj.day?.toString().padStart(2, '0') || '01'}`;
    };
    
    return {
      id: media.id.toString(),
      title: media.title.english || media.title.romaji,
      titleRomaji: media.title.romaji,
      titleNative: media.title.native,
      description: media.description?.replace(/<br>/g, '\n').replace(/<\/?[^>]+(>|$)/g, "") || "",
      genres: media.genres || [],
      thumbnail: media.coverImage?.large || "",
      banner: media.bannerImage || "",
      rating: media.averageScore / 10 || 0,
      popularity: media.popularity || 0,
      episodeCount: media.episodes?.toString() || "Unknown",
      duration: media.duration?.toString() || "Unknown",
      status: media.status || "Unknown",
      startDate: formatDate(media.startDate),
      endDate: formatDate(media.endDate),
      season: media.season || "Unknown",
      country: media.countryOfOrigin || "Unknown",
      isAdult: media.isAdult || false,
      studios: media.studios?.nodes?.map(studio => studio.name) || []
    };
  });
};

// Cache for anime data to reduce API calls
const animeCache = new Map();

// API Routes
// Get all anime (from custom list)
app.get('/api/anime', async (req, res) => {
  try {
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    
    // If we have IDs in our custom list, fetch details for each
    const animeDetails = [];
    
    for (const animeInfo of customAnimeList) {
      let animeDetail = null;
      
      // Check cache first
      if (animeCache.has(animeInfo.id)) {
        animeDetail = animeCache.get(animeInfo.id);
      } else {
        try {
          const response = await axios.post(ANILIST_API, {
            query: getAnimeQuery,
            variables: { id: parseInt(animeInfo.id) }
          });
          
          // Format the data
          animeDetail = formatAnimeData(response.data);
          
          // Cache the result
          animeCache.set(animeInfo.id, animeDetail);
        } catch (error) {
          // If AniList fails, use our stored custom data
          animeDetail = animeInfo;
        }
      }
      
      animeDetails.push(animeDetail);
    }
    
    res.json(animeDetails);
  } catch (error) {
    console.error("Error fetching anime list:", error);
    res.status(500).json({ error: 'Failed to fetch anime list' });
  }
});

// Get single anime by ID
app.get('/api/anime/:id', async (req, res) => {
  const animeId = req.params.id;
  
  try {
    // Check cache first
    if (animeCache.has(animeId)) {
      return res.json(animeCache.get(animeId));
    }
    
    // Try to fetch from AniList
    try {
      const response = await axios.post(ANILIST_API, {
        query: getAnimeQuery,
        variables: { id: parseInt(animeId) }
      });
      
      // Format the data
      const animeDetail = formatAnimeData(response.data);
      
      // Cache the result
      animeCache.set(animeId, animeDetail);
      
      res.json(animeDetail);
    } catch (anilistError) {
      // If AniList API fails, check our custom data
      const customAnimeList = readData(CUSTOM_ANIME_FILE);
      const foundAnime = customAnimeList.find(a => a.id === animeId);
      
      if (foundAnime) {
        return res.json(foundAnime);
      }
      
      return res.status(404).json({ error: 'Anime not found' });
    }
  } catch (error) {
    console.error("Error fetching anime:", error);
    res.status(500).json({ error: 'Failed to fetch anime details' });
  }
});

// Get all episodes (for dashboard)
app.get('/api/episodes', (req, res) => {
  const episodes = readData(EPISODES_FILE);
  res.json(episodes);
});

// Get episodes for an anime
app.get('/api/anime/:id/episodes', (req, res) => {
  const animeId = req.params.id;
  const episodes = readData(EPISODES_FILE);
  const animeEpisodes = episodes.filter(e => e.animeId === animeId);
  
  res.json(animeEpisodes);
});

// Get specific episode
app.get('/api/episodes/:id', (req, res) => {
  const episodeId = req.params.id;
  const episodes = readData(EPISODES_FILE);
  const foundEpisode = episodes.find(e => e.id === episodeId);
  
  if (!foundEpisode) {
    return res.status(404).json({ error: 'Episode not found' });
  }
  
  res.json(foundEpisode);
});

// Add anime to custom list
app.post('/api/anime', async (req, res) => {
  try {
    const { anilistId } = req.body;
    
    if (!anilistId) {
      return res.status(400).json({ error: 'AniList ID is required' });
    }
    
    // Check if anime already exists in our list
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    if (customAnimeList.some(a => a.id === anilistId.toString())) {
      return res.status(400).json({ error: 'Anime already exists in the list' });
    }
    
    // Fetch anime details from AniList
    const response = await axios.post(ANILIST_API, {
      query: getAnimeQuery,
      variables: { id: parseInt(anilistId) }
    });
    
    // Format the data
    const animeDetail = formatAnimeData(response.data);
    
    // Add to our custom list
    customAnimeList.push({ id: anilistId.toString() });
    
    if (writeData(CUSTOM_ANIME_FILE, customAnimeList)) {
      // Cache the result
      animeCache.set(anilistId.toString(), animeDetail);
      
      res.status(201).json(animeDetail);
    } else {
      res.status(500).json({ error: 'Failed to add anime to list' });
    }
  } catch (error) {
    console.error("Error adding anime:", error);
    
    if (error.response && error.response.data) {
      return res.status(400).json({ error: 'Invalid AniList ID or API error', details: error.response.data });
    }
    
    res.status(500).json({ error: 'Failed to add anime' });
  }
});

// Add new episode - simplified to only require animeId and server URLs
app.post('/api/episodes', async (req, res) => {
  const episodes = readData(EPISODES_FILE);
  const customAnimeList = readData(CUSTOM_ANIME_FILE);
  
  // Check if anime exists in our list
  const animeExists = customAnimeList.some(a => a.id === req.body.animeId);
  
  if (!animeExists) {
    return res.status(404).json({ error: 'Anime not found in our list' });
  }
  
  // Get existing episodes to determine the next episode number
  const existingEpisodes = episodes.filter(e => e.animeId === req.body.animeId);
  const nextEpisodeNumber = existingEpisodes.length > 0 
    ? Math.max(...existingEpisodes.map(e => e.number)) + 1 
    : 1;
  
  // Auto-generate episode title
  const episodeTitle = `Episode ${nextEpisodeNumber}`;
  
  const newEpisode = {
    id: Date.now().toString(),
    animeId: req.body.animeId,
    title: episodeTitle,
    number: nextEpisodeNumber,
    iframeSrc: req.body.iframeSrc || "",
    server2Url: req.body.server2Url || "",
    dateAdded: new Date().toISOString()
  };
  
  episodes.push(newEpisode);
  
  if (writeData(EPISODES_FILE, episodes)) {
    res.status(201).json(newEpisode);
  } else {
    res.status(500).json({ error: 'Failed to add episode' });
  }
});

// Bulk add episodes
app.post('/api/bulk-episodes', async (req, res) => {
  try {
    const { animeId, episodes: episodeUrls } = req.body;
    
    if (!animeId) {
      return res.status(400).json({ error: 'Anime ID is required' });
    }
    
    if (!episodeUrls || !Array.isArray(episodeUrls) || episodeUrls.length === 0) {
      return res.status(400).json({ error: 'Episodes array is required' });
    }
    
    // Check if anime exists
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    const animeExists = customAnimeList.some(a => a.id === animeId);
    
    if (!animeExists) {
      return res.status(404).json({ error: 'Anime not found in our list' });
    }
    
    const allEpisodes = readData(EPISODES_FILE);
    const existingEpisodes = allEpisodes.filter(e => e.animeId === animeId);
    
    // Find the highest episode number for this anime
    let nextEpisodeNumber = existingEpisodes.length > 0 
      ? Math.max(...existingEpisodes.map(e => e.number)) + 1 
      : 1;
    
    const newEpisodes = [];
    const results = {
      success: 0,
      failed: 0,
      details: []
    };
    
    // Process each episode URL
    for (const episodeData of episodeUrls) {
      try {
        // Create a new episode
        const newEpisode = {
          id: Date.now().toString() + Math.floor(Math.random() * 1000),
          animeId: animeId,
          title: `Episode ${nextEpisodeNumber}`,
          number: nextEpisodeNumber,
          iframeSrc: episodeData.iframeSrc || "",
          server2Url: episodeData.server2Url || "",
          dateAdded: new Date().toISOString()
        };
        
        newEpisodes.push(newEpisode);
        nextEpisodeNumber++;
        results.success++;
        results.details.push({ 
          episode: newEpisode.number, 
          status: 'success', 
          id: newEpisode.id 
        });
      } catch (error) {
        console.error(`Error creating episode ${nextEpisodeNumber}:`, error);
        results.failed++;
        results.details.push({ 
          episode: nextEpisodeNumber, 
          status: 'failed', 
          error: error.message 
        });
        nextEpisodeNumber++;
      }
    }
    
    // Add all new episodes to the existing ones
    allEpisodes.push(...newEpisodes);
    
    // Save to file
    if (writeData(EPISODES_FILE, allEpisodes)) {
      res.status(201).json({ 
        message: `Added ${results.success} episodes (${results.failed} failed)`,
        results 
      });
    } else {
      res.status(500).json({ error: 'Failed to save episodes to file' });
    }
  } catch (error) {
    console.error("Error in bulk episode upload:", error);
    res.status(500).json({ error: 'Failed to process bulk episode upload' });
  }
});

// Update episode
app.put('/api/episodes/:id', (req, res) => {
  const episodeId = req.params.id;
  const episodes = readData(EPISODES_FILE);
  const episodeIndex = episodes.findIndex(e => e.id === episodeId);
  
  if (episodeIndex === -1) {
    return res.status(404).json({ error: 'Episode not found' });
  }
  
  episodes[episodeIndex] = {
    ...episodes[episodeIndex],
    ...req.body,
    id: episodeId // Ensure ID remains the same
  };
  
  if (writeData(EPISODES_FILE, episodes)) {
    res.json(episodes[episodeIndex]);
  } else {
    res.status(500).json({ error: 'Failed to update episode' });
  }
});

// Remove anime from list
app.delete('/api/anime/:id', (req, res) => {
  const animeId = req.params.id;
  let customAnimeList = readData(CUSTOM_ANIME_FILE);
  let episodes = readData(EPISODES_FILE);
  
  // Remove from custom list
  customAnimeList = customAnimeList.filter(a => a.id !== animeId);
  
  // Remove associated episodes
  episodes = episodes.filter(e => e.animeId !== animeId);
  
  // Clear from cache
  animeCache.delete(animeId);
  
  if (writeData(CUSTOM_ANIME_FILE, customAnimeList) && writeData(EPISODES_FILE, episodes)) {
    res.json({ message: 'Anime and associated episodes removed successfully' });
  } else {
    res.status(500).json({ error: 'Failed to remove anime' });
  }
});

// Delete episode
app.delete('/api/episodes/:id', (req, res) => {
  const episodeId = req.params.id;
  let episodes = readData(EPISODES_FILE);
  
  const episodeIndex = episodes.findIndex(e => e.id === episodeId);
  
  if (episodeIndex === -1) {
    return res.status(404).json({ error: 'Episode not found' });
  }
  
  episodes.splice(episodeIndex, 1);
  
  if (writeData(EPISODES_FILE, episodes)) {
    res.json({ message: 'Episode deleted successfully' });
  } else {
    res.status(500).json({ error: 'Failed to delete episode' });
  }
});

// Search anime on AniList
app.get('/api/search', async (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Query parameter required' });
  }
  
  try {
    const response = await axios.post(ANILIST_API, {
      query: searchAnimeQuery,
      variables: { search: query }
    });
    
    // Format the data
    const searchResults = formatSearchResults(response.data);
    
    res.json(searchResults);
  } catch (error) {
    console.error("Error searching anime:", error);
    res.status(500).json({ error: 'Failed to search anime' });
  }
});

// Export data
app.get('/api/export', (req, res) => {
  const customAnimeList = readData(CUSTOM_ANIME_FILE);
  const episodes = readData(EPISODES_FILE);
  
  const exportData = {
    anime: customAnimeList,
    episodes,
    exportDate: new Date().toISOString(),
    exportVersion: "1.0"
  };
  
  res.json(exportData);
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Handle SPA routing for admin panel
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`API Documentation: http://${HOST}:${PORT}`);
});

// Handle errors gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
