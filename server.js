const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // This ensures binding to all network interfaces

// Add proper error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Configure CORS for better security and browser compatibility
const corsOptions = {
  origin: '*', // In production, you might want to restrict this
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: '10mb' })); // Increased limit for bulk uploads
app.use(express.static('public'));

// Data directory configuration - use environment variable for data directory in production
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const EPISODES_FILE = path.join(DATA_DIR, 'episodes.json');
const CUSTOM_ANIME_FILE = path.join(DATA_DIR, 'custom_anime.json');
const SCHEDULED_RELEASES_FILE = path.join(DATA_DIR, 'scheduled_releases.json');

// Create data directory if it doesn't exist
app.use((req, res, next) => {
  // Check if data directory exists and is writable
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log(`Created data directory: ${DATA_DIR}`);
    } catch (err) {
      console.error(`Failed to create data directory: ${err.message}`);
    }
  }
  next();
});

// Initialize data files if they don't exist
const initializeDataFile = (filePath, initialData) => {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2));
      console.log(`Initialized ${path.basename(filePath)} with empty data`);
    }
  } catch (error) {
    console.error(`Error initializing ${filePath}:`, error);
  }
};

initializeDataFile(EPISODES_FILE, []);
initializeDataFile(CUSTOM_ANIME_FILE, []);
initializeDataFile(SCHEDULED_RELEASES_FILE, []);

// Helper functions to read and write data
const readData = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`File doesn't exist: ${filePath}, creating empty file`);
      fs.writeFileSync(filePath, JSON.stringify([], null, 2));
      return [];
    }
    
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

// AniList GraphQL API configuration
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
  if (!anilistData || !anilistData.data || !anilistData.data.Media) {
    console.error("Invalid AniList data:", anilistData);
    return null;
  }

  const media = anilistData.data.Media;
  
  // Format date
  const formatDate = (dateObj) => {
    if (!dateObj || !dateObj.year) return null;
    return `${dateObj.year}-${dateObj.month?.toString().padStart(2, '0') || '01'}-${dateObj.day?.toString().padStart(2, '0') || '01'}`;
  };
  
  return {
    id: media.id.toString(),
    title: media.title.english || media.title.romaji || media.title.native,
    titleRomaji: media.title.romaji,
    titleNative: media.title.native,
    description: media.description?.replace(/<br>/g, '\n').replace(/<\/?[^>]+(>|$)/g, "") || "",
    genres: media.genres || [],
    thumbnail: media.coverImage?.large || "",
    banner: media.bannerImage || "",
    rating: (media.averageScore ? media.averageScore / 10 : 0) || 0,
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
  if (!anilistData || !anilistData.data || !anilistData.data.Page || !anilistData.data.Page.media) {
    console.error("Invalid search data:", anilistData);
    return [];
  }

  return anilistData.data.Page.media.map(media => {
    // Format date
    const formatDate = (dateObj) => {
      if (!dateObj || !dateObj.year) return null;
      return `${dateObj.year}-${dateObj.month?.toString().padStart(2, '0') || '01'}-${dateObj.day?.toString().padStart(2, '0') || '01'}`;
    };
    
    return {
      id: media.id.toString(),
      title: media.title.english || media.title.romaji || media.title.native,
      titleRomaji: media.title.romaji,
      titleNative: media.title.native,
      description: media.description?.replace(/<br>/g, '\n').replace(/<\/?[^>]+(>|$)/g, "") || "",
      genres: media.genres || [],
      thumbnail: media.coverImage?.large || "",
      banner: media.bannerImage || "",
      rating: (media.averageScore ? media.averageScore / 10 : 0) || 0,
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

// Make AniList API request with proper error handling
const makeAnilistRequest = async (query, variables) => {
  try {
    console.log(`AniList API request: ${JSON.stringify(variables)}`);
    
    const response = await axios.post(ANILIST_API, {
      query,
      variables
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 10000 // 10 second timeout
    });
    
    console.log(`AniList API response status: ${response.status}`);
    return response.data;
  } catch (error) {
    if (error.response) {
      console.error('AniList API error response:', error.response.status, error.response.data);
    } else if (error.request) {
      console.error('No response from AniList API:', error.message);
    } else {
      console.error('Error setting up AniList request:', error.message);
    }
    throw error;
  }
};

// API Routes
// Get all anime (from custom list)
app.get('/api/anime', async (req, res) => {
  try {
    console.log('GET /api/anime');
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    
    // If list is empty, return empty array immediately
    if (customAnimeList.length === 0) {
      return res.json([]);
    }
    
    const animeDetails = [];
    
    for (const animeInfo of customAnimeList) {
      try {
        console.log(`Fetching anime details for ID: ${animeInfo.id}`);
        
        // Fetch from AniList
        const anilistData = await makeAnilistRequest(getAnimeQuery, { id: parseInt(animeInfo.id) });
        const animeDetail = formatAnimeData(anilistData);
        
        if (animeDetail) {
          // Add custom fields
          if (animeInfo.scheduleDate) {
            animeDetail.scheduleDate = animeInfo.scheduleDate;
          }
          
          animeDetails.push(animeDetail);
        } else {
          console.warn(`Couldn't format data for anime ID: ${animeInfo.id}`);
          // Add minimal info
          animeDetails.push({
            id: animeInfo.id,
            title: animeInfo.title || `Anime #${animeInfo.id}`,
            dateAdded: animeInfo.dateAdded || new Date().toISOString()
          });
        }
      } catch (error) {
        console.error(`Error fetching anime ${animeInfo.id}:`, error.message);
        // Still include minimal info
        animeDetails.push({
          id: animeInfo.id,
          title: animeInfo.title || `Anime #${animeInfo.id}`,
          dateAdded: animeInfo.dateAdded || new Date().toISOString()
        });
      }
    }
    
    res.json(animeDetails);
  } catch (error) {
    console.error("Error fetching anime list:", error);
    res.status(500).json({ error: 'Failed to fetch anime list', details: error.message });
  }
});

// Get single anime by ID
app.get('/api/anime/:id', async (req, res) => {
  const animeId = req.params.id;
  
  try {
    console.log(`GET /api/anime/${animeId}`);
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    const animeInfo = customAnimeList.find(a => a.id === animeId);
    
    if (!animeInfo) {
      return res.status(404).json({ error: 'Anime not found in library' });
    }
    
    try {
      // Fetch from AniList
      const anilistData = await makeAnilistRequest(getAnimeQuery, { id: parseInt(animeId) });
      const animeDetail = formatAnimeData(anilistData);
      
      if (animeDetail) {
        // Add custom fields
        if (animeInfo.scheduleDate) {
          animeDetail.scheduleDate = animeInfo.scheduleDate;
        }
        
        res.json(animeDetail);
      } else {
        // Fallback to basic info
        res.json({
          id: animeInfo.id,
          title: animeInfo.title || `Anime #${animeInfo.id}`,
          dateAdded: animeInfo.dateAdded || new Date().toISOString(),
          scheduleDate: animeInfo.scheduleDate
        });
      }
    } catch (error) {
      console.error(`Error fetching anime ${animeId} from AniList:`, error.message);
      // Fallback to basic info
      res.json({
        id: animeInfo.id,
        title: animeInfo.title || `Anime #${animeInfo.id}`,
        dateAdded: animeInfo.dateAdded || new Date().toISOString(),
        scheduleDate: animeInfo.scheduleDate
      });
    }
  } catch (error) {
    console.error("Error fetching anime:", error);
    res.status(500).json({ error: 'Failed to fetch anime details', details: error.message });
  }
});

// Get all episodes (for dashboard)
app.get('/api/episodes', (req, res) => {
  try {
    console.log('GET /api/episodes');
    const episodes = readData(EPISODES_FILE);
    
    // Handle filter by date range
    const { from, to } = req.query;
    
    if (from || to) {
      const fromDate = from ? new Date(from) : new Date(0);
      const toDate = to ? new Date(to) : new Date();
      
      const filteredEpisodes = episodes.filter(episode => {
        const episodeDate = episode.releaseDate 
          ? new Date(episode.releaseDate) 
          : new Date(episode.dateAdded);
          
        return episodeDate >= fromDate && episodeDate <= toDate;
      });
      
      return res.json(filteredEpisodes);
    }
    
    res.json(episodes);
  } catch (error) {
    console.error("Error fetching episodes:", error);
    res.status(500).json({ error: 'Failed to fetch episodes', details: error.message });
  }
});

// Get episodes for an anime
app.get('/api/anime/:id/episodes', (req, res) => {
  try {
    const animeId = req.params.id;
    console.log(`GET /api/anime/${animeId}/episodes`);
    
    const episodes = readData(EPISODES_FILE);
    const animeEpisodes = episodes.filter(e => e.animeId === animeId);
    
    // Sort by episode number by default
    animeEpisodes.sort((a, b) => a.number - b.number);
    
    res.json(animeEpisodes);
  } catch (error) {
    console.error("Error fetching episodes for anime:", error);
    res.status(500).json({ error: 'Failed to fetch episodes', details: error.message });
  }
});

// Get specific episode
app.get('/api/episodes/:id', (req, res) => {
  try {
    const episodeId = req.params.id;
    console.log(`GET /api/episodes/${episodeId}`);
    
    const episodes = readData(EPISODES_FILE);
    const foundEpisode = episodes.find(e => e.id === episodeId);
    
    if (!foundEpisode) {
      return res.status(404).json({ error: 'Episode not found' });
    }
    
    res.json(foundEpisode);
  } catch (error) {
    console.error("Error fetching episode:", error);
    res.status(500).json({ error: 'Failed to fetch episode', details: error.message });
  }
});

// Get scheduled releases
app.get('/api/schedule', (req, res) => {
  try {
    console.log('GET /api/schedule');
    const episodes = readData(EPISODES_FILE);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Find episodes with release dates in the future
    const scheduledEpisodes = episodes.filter(episode => {
      if (!episode.releaseDate) return false;
      
      const releaseDate = new Date(episode.releaseDate);
      releaseDate.setHours(0, 0, 0, 0);
      
      return releaseDate >= today;
    });
    
    // Sort by release date
    scheduledEpisodes.sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
    
    res.json(scheduledEpisodes);
  } catch (error) {
    console.error("Error fetching scheduled releases:", error);
    res.status(500).json({ error: 'Failed to fetch scheduled releases', details: error.message });
  }
});

// Add anime to custom list
app.post('/api/anime', async (req, res) => {
  try {
    console.log('POST /api/anime', req.body);
    const { anilistId, scheduleDate, title } = req.body;
    
    if (!anilistId) {
      return res.status(400).json({ error: 'AniList ID is required' });
    }
    
    // Check if anime already exists in our list
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    if (customAnimeList.some(a => a.id === anilistId.toString())) {
      return res.status(400).json({ error: 'Anime already exists in the list' });
    }
    
    let animeDetail = null;
    
    try {
      // Fetch anime details from AniList
      const anilistData = await makeAnilistRequest(getAnimeQuery, { id: parseInt(anilistId) });
      animeDetail = formatAnimeData(anilistData);
      
      if (!animeDetail) {
        throw new Error('Failed to get anime details from AniList');
      }
    } catch (apiError) {
      console.error("AniList API error:", apiError.message);
      
      // Create a minimal anime entry if API fails
      animeDetail = {
        id: anilistId.toString(),
        title: title || `Anime #${anilistId}`,
        dateAdded: new Date().toISOString()
      };
    }
    
    // Add schedule date if provided
    if (scheduleDate) {
      animeDetail.scheduleDate = scheduleDate;
    }
    
    // Add to our custom list
    customAnimeList.push({
      id: anilistId.toString(),
      title: animeDetail.title,
      dateAdded: new Date().toISOString(),
      scheduleDate: scheduleDate
    });
    
    if (writeData(CUSTOM_ANIME_FILE, customAnimeList)) {
      res.status(201).json(animeDetail);
    } else {
      res.status(500).json({ error: 'Failed to add anime to list' });
    }
  } catch (error) {
    console.error("Error adding anime:", error);
    res.status(500).json({ error: 'Failed to add anime', details: error.message });
  }
});

// Add new episode
app.post('/api/episodes', async (req, res) => {
  try {
    console.log('POST /api/episodes', req.body);
    const episodes = readData(EPISODES_FILE);
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    
    // Check required fields
    if (!req.body.animeId) {
      return res.status(400).json({ error: 'Anime ID is required' });
    }
    
    if (!req.body.server2Url) {
      return res.status(400).json({ error: 'Server 2 URL is required' });
    }
    
    // Check if anime exists in our list
    const animeInfo = customAnimeList.find(a => a.id === req.body.animeId);
    if (!animeInfo) {
      return res.status(404).json({ error: 'Anime not found in our list' });
    }
    
    // Get existing episodes to determine the next episode number
    const existingEpisodes = episodes.filter(e => e.animeId === req.body.animeId);
    
    // If number is provided, check if it already exists
    if (req.body.number) {
      const numberExists = existingEpisodes.some(e => parseInt(e.number) === parseInt(req.body.number));
      if (numberExists) {
        return res.status(400).json({ error: `Episode number ${req.body.number} already exists for this anime` });
      }
    }
    
    const nextEpisodeNumber = req.body.number ? parseInt(req.body.number) : 
        (existingEpisodes.length > 0 ? Math.max(...existingEpisodes.map(e => parseInt(e.number) || 0)) + 1 : 1);
    
    // Auto-generate episode title if not provided
    const episodeTitle = req.body.title || `Episode ${nextEpisodeNumber}`;
    
    const newEpisode = {
      id: Date.now().toString(), // Use timestamp for unique ID
      animeId: req.body.animeId,
      animeTitle: animeInfo.title || 'Unknown Anime',
      title: episodeTitle,
      number: nextEpisodeNumber,
      iframeSrc: req.body.iframeSrc || "",
      server2Url: req.body.server2Url,
      dateAdded: new Date().toISOString()
    };
    
    // Add release date if provided
    if (req.body.releaseDate) {
      newEpisode.releaseDate = req.body.releaseDate;
    }
    
    episodes.push(newEpisode);
    
    if (writeData(EPISODES_FILE, episodes)) {
      res.status(201).json(newEpisode);
    } else {
      res.status(500).json({ error: 'Failed to add episode' });
    }
  } catch (error) {
    console.error("Error adding episode:", error);
    res.status(500).json({ error: 'Failed to add episode', details: error.message });
  }
});

// Update episode
app.put('/api/episodes/:id', (req, res) => {
  try {
    const episodeId = req.params.id;
    console.log(`PUT /api/episodes/${episodeId}`, req.body);
    
    const episodes = readData(EPISODES_FILE);
    const episodeIndex = episodes.findIndex(e => e.id === episodeId);
    
    if (episodeIndex === -1) {
      return res.status(404).json({ error: 'Episode not found' });
    }
    
    const originalEpisode = episodes[episodeIndex];
    
    // Create updated episode object
    const updatedEpisode = {
      ...originalEpisode,
      ...req.body,
      id: episodeId, // Ensure ID remains the same
      lastUpdated: new Date().toISOString()
    };
    
    episodes[episodeIndex] = updatedEpisode;
    
    if (writeData(EPISODES_FILE, episodes)) {
      res.json(updatedEpisode);
    } else {
      res.status(500).json({ error: 'Failed to update episode' });
    }
  } catch (error) {
    console.error("Error updating episode:", error);
    res.status(500).json({ error: 'Failed to update episode', details: error.message });
  }
});

// Remove anime from list
app.delete('/api/anime/:id', (req, res) => {
  try {
    const animeId = req.params.id;
    console.log(`DELETE /api/anime/${animeId}`);
    
    let customAnimeList = readData(CUSTOM_ANIME_FILE);
    let episodes = readData(EPISODES_FILE);
    
    // Check if anime exists
    const animeExists = customAnimeList.some(a => a.id === animeId);
    
    if (!animeExists) {
      return res.status(404).json({ error: 'Anime not found' });
    }
    
    // Remove from custom list
    customAnimeList = customAnimeList.filter(a => a.id !== animeId);
    
    // Remove associated episodes
    const removedEpisodes = episodes.filter(e => e.animeId === animeId);
    episodes = episodes.filter(e => e.animeId !== animeId);
    
    if (writeData(CUSTOM_ANIME_FILE, customAnimeList) && writeData(EPISODES_FILE, episodes)) {
      res.json({ 
        message: 'Anime and associated episodes removed successfully',
        removedEpisodes: removedEpisodes.length
      });
    } else {
      res.status(500).json({ error: 'Failed to remove anime' });
    }
  } catch (error) {
    console.error("Error removing anime:", error);
    res.status(500).json({ error: 'Failed to remove anime', details: error.message });
  }
});

// Delete episode
app.delete('/api/episodes/:id', (req, res) => {
  try {
    const episodeId = req.params.id;
    console.log(`DELETE /api/episodes/${episodeId}`);
    
    let episodes = readData(EPISODES_FILE);
    
    const episodeIndex = episodes.findIndex(e => e.id === episodeId);
    
    if (episodeIndex === -1) {
      return res.status(404).json({ error: 'Episode not found' });
    }
    
    // Save episode info before removal
    const removedEpisode = episodes[episodeIndex];
    
    // Remove episode
    episodes.splice(episodeIndex, 1);
    
    if (writeData(EPISODES_FILE, episodes)) {
      res.json({ 
        message: 'Episode deleted successfully',
        removedEpisode: {
          id: removedEpisode.id,
          animeId: removedEpisode.animeId,
          number: removedEpisode.number,
          title: removedEpisode.title
        }
      });
    } else {
      res.status(500).json({ error: 'Failed to delete episode' });
    }
  } catch (error) {
    console.error("Error deleting episode:", error);
    res.status(500).json({ error: 'Failed to delete episode', details: error.message });
  }
});

// Search anime on AniList
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    console.log(`GET /api/search?query=${query}`);
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter required' });
    }
    
    // Direct call to AniList API
    const anilistData = await makeAnilistRequest(searchAnimeQuery, { search: query });
    
    // Format the data
    const searchResults = formatSearchResults(anilistData);
    
    // Filter out adult content (optional, can be removed if adult content is allowed)
    const filteredResults = searchResults.filter(anime => !anime.isAdult);
    
    res.json(filteredResults);
  } catch (error) {
    console.error("Error searching anime:", error);
    // Return empty array instead of error for better UX
    res.json([]);
  }
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  try {
    // Check if data directory exists and create if needed
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log(`Created data directory: ${DATA_DIR}`);
    }
    
    // Initialize data files if they don't exist
    initializeDataFile(EPISODES_FILE, []);
    initializeDataFile(CUSTOM_ANIME_FILE, []);
    initializeDataFile(SCHEDULED_RELEASES_FILE, []);
    
    // Try AniList API test call
    axios.post(ANILIST_API, {
      query: `{ Viewer { id } }`,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 5000 // 5 second timeout
    })
    .then(() => {
      res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        anilistApi: 'connected',
        directories: {
          data: fs.existsSync(DATA_DIR),
          episodes: fs.existsSync(EPISODES_FILE),
          anime: fs.existsSync(CUSTOM_ANIME_FILE)
        }
      });
    })
    .catch(apiError => {
      console.warn("AniList API test failed:", apiError.message);
      res.status(200).json({ 
        status: 'warning', 
        timestamp: new Date().toISOString(),
        anilistApi: 'disconnected',
        apiError: apiError.message,
        directories: {
          data: fs.existsSync(DATA_DIR),
          episodes: fs.existsSync(EPISODES_FILE),
          anime: fs.existsSync(CUSTOM_ANIME_FILE)
        }
      });
    });
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(500).json({ 
      status: 'error', 
      error: error.message,
      timestamp: new Date().toISOString() 
    });
  }
});

// Handle SPA routing for admin panel
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
const server = app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`API Documentation: http://${HOST}:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

// Handle errors gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // In production, you might want to restart the server automatically
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
