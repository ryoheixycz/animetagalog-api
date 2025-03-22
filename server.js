const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // This ensures binding to all network interfaces

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
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize data files if they don't exist
const initializeDataFile = (filePath, initialData) => {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2));
        console.log(`Initialized ${path.basename(filePath)} with empty data`);
    }
};

initializeDataFile(EPISODES_FILE, []);
initializeDataFile(CUSTOM_ANIME_FILE, []);
initializeDataFile(SCHEDULED_RELEASES_FILE, []);

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

// Implement file locking for concurrent writes
const locks = {};

const acquireLock = (resource) => {
    return new Promise((resolve) => {
        const checkAndAcquire = () => {
            if (!locks[resource]) {
                locks[resource] = true;
                return resolve();
            }
            setTimeout(checkAndAcquire, 50);
        };
        checkAndAcquire();
    });
};

const releaseLock = (resource) => {
    locks[resource] = false;
};

const writeDataWithLock = async (filePath, data) => {
    await acquireLock(filePath);
    try {
        const result = writeData(filePath, data);
        return result;
    } finally {
        releaseLock(filePath);
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

// Rate limiting for AniList API
let lastRequest = 0;
const requestDelay = 500; // 500ms between requests to avoid rate limiting

const makeAnilistRequest = async (query, variables) => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequest;
    
    if (timeSinceLastRequest < requestDelay) {
        await new Promise(resolve => setTimeout(resolve, requestDelay - timeSinceLastRequest));
    }
    
    lastRequest = Date.now();
    
    try {
        const response = await axios.post(ANILIST_API, {
            query,
            variables
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            }
        });
        
        return response.data;
    } catch (error) {
        if (error.response) {
            console.error('AniList API error:', error.response.data);
        }
        throw error;
    }
};

// API Routes
// Get all anime (from custom list)
app.get('/api/anime', async (req, res) => {
  try {
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    const animeDetails = [];
    
    // Batch anime requests to reduce load
    const batchSize = 5;
    
    for (let i = 0; i < customAnimeList.length; i += batchSize) {
      const batch = customAnimeList.slice(i, i + batchSize);
      
      // Process each batch in parallel
      const batchPromises = batch.map(async (animeInfo) => {
        let animeDetail = null;
        
        // Check cache first
        if (animeCache.has(animeInfo.id)) {
          animeDetail = Object.assign({}, animeCache.get(animeInfo.id));
        } else {
          try {
            const anilistData = await makeAnilistRequest(getAnimeQuery, { id: parseInt(animeInfo.id) });
            animeDetail = formatAnimeData(anilistData);
            
            // Cache the result for an hour
            animeCache.set(animeInfo.id, animeDetail);
            setTimeout(() => animeCache.delete(animeInfo.id), 3600000); // 1 hour cache
            
          } catch (error) {
            console.error(`Error fetching anime ${animeInfo.id} from AniList:`, error.message);
            // If AniList fails, use our stored custom data
            animeDetail = Object.assign({}, animeInfo);
          }
        }
        
        // Add custom fields from our database that may not be in the cache
        if (animeInfo.scheduleDate) {
          animeDetail.scheduleDate = animeInfo.scheduleDate;
        }
        
        if (animeInfo.notes) {
          animeDetail.notes = animeInfo.notes;
        }
        
        return animeDetail;
      });
      
      // Wait for current batch to complete
      const batchResults = await Promise.all(batchPromises);
      animeDetails.push(...batchResults);
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
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    const animeInfo = customAnimeList.find(a => a.id === animeId);
    
    if (!animeInfo) {
      return res.status(404).json({ error: 'Anime not found in library' });
    }
    
    let animeDetail;
    
    // Check cache first
    if (animeCache.has(animeId)) {
      animeDetail = Object.assign({}, animeCache.get(animeId));
    } else {
      try {
        const anilistData = await makeAnilistRequest(getAnimeQuery, { id: parseInt(animeId) });
        animeDetail = formatAnimeData(anilistData);
        
        // Cache the result
        animeCache.set(animeId, animeDetail);
      } catch (error) {
        console.error(`Error fetching anime ${animeId} from AniList:`, error.message);
        animeDetail = Object.assign({}, animeInfo);
      }
    }
    
    // Add custom fields
    if (animeInfo.scheduleDate) {
      animeDetail.scheduleDate = animeInfo.scheduleDate;
    }
    
    if (animeInfo.notes) {
      animeDetail.notes = animeInfo.notes;
    }
    
    res.json(animeDetail);
  } catch (error) {
    console.error("Error fetching anime:", error);
    res.status(500).json({ error: 'Failed to fetch anime details', details: error.message });
  }
});

// Get all episodes (for dashboard)
app.get('/api/episodes', (req, res) => {
  try {
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
    const { anilistId, scheduleDate, notes } = req.body;
    
    if (!anilistId) {
      return res.status(400).json({ error: 'AniList ID is required' });
    }
    
    // Check if anime already exists in our list
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    if (customAnimeList.some(a => a.id === anilistId.toString())) {
      return res.status(400).json({ error: 'Anime already exists in the list' });
    }
    
    // Fetch anime details from AniList
    const anilistData = await makeAnilistRequest(getAnimeQuery, { id: parseInt(anilistId) });
    
    if (!anilistData || !anilistData.data || !anilistData.data.Media) {
      return res.status(404).json({ error: 'Anime not found on AniList' });
    }
    
    // Format the data
    const animeDetail = formatAnimeData(anilistData);
    
    // Create custom anime entry
    const customAnimeEntry = {
      id: anilistId.toString(),
      dateAdded: new Date().toISOString()
    };
    
    // Add optional fields
    if (scheduleDate) {
      customAnimeEntry.scheduleDate = scheduleDate;
      animeDetail.scheduleDate = scheduleDate;
    }
    
    if (notes) {
      customAnimeEntry.notes = notes;
      animeDetail.notes = notes;
    }
    
    // Add to our custom list
    customAnimeList.push(customAnimeEntry);
    
    if (await writeDataWithLock(CUSTOM_ANIME_FILE, customAnimeList)) {
      // Cache the result
      animeCache.set(anilistId.toString(), animeDetail);
      
      // Add to scheduled releases if scheduled
      if (scheduleDate) {
        const scheduledReleases = readData(SCHEDULED_RELEASES_FILE);
        
        scheduledReleases.push({
          id: anilistId.toString(),
          type: 'anime',
          title: animeDetail.title,
          releaseDate: scheduleDate,
          dateAdded: new Date().toISOString()
        });
        
        await writeDataWithLock(SCHEDULED_RELEASES_FILE, scheduledReleases);
      }
      
      res.status(201).json(animeDetail);
    } else {
      res.status(500).json({ error: 'Failed to add anime to list' });
    }
  } catch (error) {
    console.error("Error adding anime:", error);
    
    if (error.response && error.response.data) {
      return res.status(400).json({ error: 'Invalid AniList ID or API error', details: error.response.data });
    }
    
    res.status(500).json({ error: 'Failed to add anime', details: error.message });
  }
});

// Update anime details
app.put('/api/anime/:id', async (req, res) => {
  try {
    const animeId = req.params.id;
    const { scheduleDate, notes } = req.body;
    
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    const animeIndex = customAnimeList.findIndex(a => a.id === animeId);
    
    if (animeIndex === -1) {
      return res.status(404).json({ error: 'Anime not found' });
    }
    
    // Update custom anime entry
    const updatedEntry = { ...customAnimeList[animeIndex] };
    
    if (scheduleDate !== undefined) {
      updatedEntry.scheduleDate = scheduleDate;
    }
    
    if (notes !== undefined) {
      updatedEntry.notes = notes;
    }
    
    updatedEntry.lastUpdated = new Date().toISOString();
    
    customAnimeList[animeIndex] = updatedEntry;
    
    if (await writeDataWithLock(CUSTOM_ANIME_FILE, customAnimeList)) {
      // Update cache if exists
      if (animeCache.has(animeId)) {
        const cachedAnime = animeCache.get(animeId);
        const updatedCache = { ...cachedAnime };
        
        if (scheduleDate !== undefined) {
          updatedCache.scheduleDate = scheduleDate;
        }
        
        if (notes !== undefined) {
          updatedCache.notes = notes;
        }
        
        animeCache.set(animeId, updatedCache);
      }
      
      // Update scheduled releases if scheduled date changed
      if (scheduleDate !== undefined) {
        const scheduledReleases = readData(SCHEDULED_RELEASES_FILE);
        const releaseIndex = scheduledReleases.findIndex(r => r.id === animeId && r.type === 'anime');
        
        // Get anime title
        let animeTitle = updatedEntry.title;
        if (animeCache.has(animeId)) {
          animeTitle = animeCache.get(animeId).title;
        }
        
        if (scheduleDate && releaseIndex === -1) {
          // Add new scheduled release
          scheduledReleases.push({
            id: animeId,
            type: 'anime',
            title: animeTitle,
            releaseDate: scheduleDate,
            dateAdded: new Date().toISOString()
          });
        } else if (scheduleDate && releaseIndex !== -1) {
          // Update existing scheduled release
          scheduledReleases[releaseIndex].releaseDate = scheduleDate;
          scheduledReleases[releaseIndex].lastUpdated = new Date().toISOString();
        } else if (!scheduleDate && releaseIndex !== -1) {
          // Remove scheduled release
          scheduledReleases.splice(releaseIndex, 1);
        }
        
        await writeDataWithLock(SCHEDULED_RELEASES_FILE, scheduledReleases);
      }
      
      res.json(updatedEntry);
    } else {
      res.status(500).json({ error: 'Failed to update anime' });
    }
  } catch (error) {
    console.error("Error updating anime:", error);
    res.status(500).json({ error: 'Failed to update anime', details: error.message });
  }
});

// Add new episode
app.post('/api/episodes', async (req, res) => {
  try {
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
    const animeExists = customAnimeList.some(a => a.id === req.body.animeId);
    
    if (!animeExists) {
      return res.status(404).json({ error: 'Anime not found in our list' });
    }
    
    // Get existing episodes to determine the next episode number
    const existingEpisodes = episodes.filter(e => e.animeId === req.body.animeId);
    
    // If number is provided, check if it already exists
    if (req.body.number) {
      const numberExists = existingEpisodes.some(e => e.number === parseInt(req.body.number));
      if (numberExists) {
        return res.status(400).json({ error: `Episode number ${req.body.number} already exists for this anime` });
      }
    }
    
    const nextEpisodeNumber = req.body.number ? parseInt(req.body.number) : 
        (existingEpisodes.length > 0 ? Math.max(...existingEpisodes.map(e => e.number)) + 1 : 1);
    
    // Auto-generate episode title if not provided
    const episodeTitle = req.body.title || `Episode ${nextEpisodeNumber}`;
    
    const newEpisode = {
      id: Date.now().toString(), // Use timestamp for unique ID
      animeId: req.body.animeId,
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
    
    if (await writeDataWithLock(EPISODES_FILE, episodes)) {
      // If there's a release date, add to scheduled releases
      if (req.body.releaseDate) {
        const releaseDate = new Date(req.body.releaseDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (releaseDate >= today) {
          // Get anime title
          let animeTitle = 'Unknown Anime';
          
          if (animeCache.has(req.body.animeId)) {
            animeTitle = animeCache.get(req.body.animeId).title;
          } else {
            // Try to find the anime in our custom list
            const animeInfo = customAnimeList.find(a => a.id === req.body.animeId);
            if (animeInfo && animeInfo.title) {
              animeTitle = animeInfo.title;
            }
          }
          
          const scheduledReleases = readData(SCHEDULED_RELEASES_FILE);
          
          scheduledReleases.push({
            id: newEpisode.id,
            type: 'episode',
            animeId: req.body.animeId,
            animeTitle: animeTitle,
            episodeNumber: nextEpisodeNumber,
            episodeTitle: episodeTitle,
            releaseDate: req.body.releaseDate,
            dateAdded: new Date().toISOString()
          });
          
          await writeDataWithLock(SCHEDULED_RELEASES_FILE, scheduledReleases);
        }
      }
      
      res.status(201).json(newEpisode);
    } else {
      res.status(500).json({ error: 'Failed to add episode' });
    }
  } catch (error) {
    console.error("Error adding episode:", error);
    res.status(500).json({ error: 'Failed to add episode', details: error.message });
  }
});

// Bulk add episodes
app.post('/api/episodes/bulk', async (req, res) => {
  try {
    if (!Array.isArray(req.body.episodes) || req.body.episodes.length === 0) {
      return res.status(400).json({ error: 'Episodes array is required and must not be empty' });
    }
    
    const { animeId, episodes: newEpisodes, replaceExisting } = req.body;
    
    if (!animeId) {
      return res.status(400).json({ error: 'Anime ID is required' });
    }
    
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    
    // Check if anime exists
    const animeExists = customAnimeList.some(a => a.id === animeId);
    
    if (!animeExists) {
      return res.status(404).json({ error: 'Anime not found in our list' });
    }
    
    // Get existing episodes
    let episodes = readData(EPISODES_FILE);
    
    // If replacing existing, remove all episodes for this anime
    if (replaceExisting) {
      episodes = episodes.filter(e => e.animeId !== animeId);
    }
    
    // Get anime title for scheduled releases
    let animeTitle = 'Unknown Anime';
    
    if (animeCache.has(animeId)) {
      animeTitle = animeCache.get(animeId).title;
    } else {
      // Try to find the anime in our custom list
      const animeInfo = customAnimeList.find(a => a.id === animeId);
      if (animeInfo && animeInfo.title) {
        animeTitle = animeInfo.title;
      }
    }
    
    // Prepare new episodes and validate
    const processedEpisodes = [];
    const currentTimestamp = Date.now();
    const existingNumbers = new Set(episodes.filter(e => e.animeId === animeId).map(e => e.number));
    const scheduledReleases = readData(SCHEDULED_RELEASES_FILE);
    const newScheduledReleases = [];
    
    for (let i = 0; i < newEpisodes.length; i++) {
      const episode = newEpisodes[i];
      
      // Check required fields
      if (!episode.server2Url) {
        return res.status(400).json({ 
          error: `Episode at index ${i} is missing server2Url`, 
          episode: episode 
        });
      }
      
      // Set episode number if not provided
      const number = episode.number ? parseInt(episode.number) : i + 1;
      
      // Skip episode if number already exists and not replacing
      if (!replaceExisting && existingNumbers.has(number)) {
        continue;
      }
      
      const newEpisode = {
        id: `${currentTimestamp + i}`,
        animeId: animeId,
        title: episode.title || `Episode ${number}`,
        number: number,
        iframeSrc: episode.iframeSrc || "",
        server2Url: episode.server2Url,
        dateAdded: new Date().toISOString()
      };
      
      // Add release date if provided
      if (episode.releaseDate) {
        newEpisode.releaseDate = episode.releaseDate;
        
        // Add to scheduled releases if in the future
        const releaseDate = new Date(episode.releaseDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (releaseDate >= today) {
          newScheduledReleases.push({
            id: newEpisode.id,
            type: 'episode',
            animeId: animeId,
            animeTitle: animeTitle,
            episodeNumber: number,
            episodeTitle: newEpisode.title,
            releaseDate: episode.releaseDate,
            dateAdded: new Date().toISOString()
          });
        }
      }
      
      processedEpisodes.push(newEpisode);
      existingNumbers.add(number);
    }
    
    // Add new episodes to the existing ones
    episodes.push(...processedEpisodes);
    
    // Sort episodes by anime ID and episode number for better organization
    episodes.sort((a, b) => {
      if (a.animeId !== b.animeId) {
        return a.animeId.localeCompare(b.animeId);
      }
      return a.number - b.number;
    });
    
    if (await writeDataWithLock(EPISODES_FILE, episodes)) {
      // Add new scheduled releases
      if (newScheduledReleases.length > 0) {
        // Remove old scheduled releases for this anime if replacing
        if (replaceExisting) {
          const existingEpisodeIds = episodes
            .filter(e => e.animeId === animeId)
            .map(e => e.id);
            
          // Filter out episodes for this anime that aren't in the new list
          scheduledReleases = scheduledReleases.filter(release => 
            !(release.type === 'episode' && release.animeId === animeId) || 
            existingEpisodeIds.includes(release.id)
          );
        }
        
        scheduledReleases.push(...newScheduledReleases);
        await writeDataWithLock(SCHEDULED_RELEASES_FILE, scheduledReleases);
      }
      
      res.status(201).json({
        success: true, 
        added: processedEpisodes.length,
        episodes: processedEpisodes
      });
    } else {
      res.status(500).json({ error: 'Failed to add episodes' });
    }
  } catch (error) {
    console.error("Error adding bulk episodes:", error);
    res.status(500).json({ error: 'Failed to add bulk episodes', details: error.message });
  }
});

// Update episode
app.put('/api/episodes/:id', async (req, res) => {
  try {
    const episodeId = req.params.id;
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
    
    if (await writeDataWithLock(EPISODES_FILE, episodes)) {
      // Update scheduled releases if release date changed
      if (req.body.releaseDate !== undefined && req.body.releaseDate !== originalEpisode.releaseDate) {
        const scheduledReleases = readData(SCHEDULED_RELEASES_FILE);
        const releaseIndex = scheduledReleases.findIndex(r => 
          r.id === episodeId && r.type === 'episode'
        );
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const newReleaseDate = req.body.releaseDate ? new Date(req.body.releaseDate) : null;
        const isFutureRelease = newReleaseDate && newReleaseDate >= today;
        
        // Get anime title
        let animeTitle = 'Unknown Anime';
        if (animeCache.has(updatedEpisode.animeId)) {
          animeTitle = animeCache.get(updatedEpisode.animeId).title;
        }
        
        if (isFutureRelease && releaseIndex === -1) {
          // Add new scheduled release
          scheduledReleases.push({
            id: episodeId,
            type: 'episode',
            animeId: updatedEpisode.animeId,
            animeTitle: animeTitle,
            episodeNumber: updatedEpisode.number,
            episodeTitle: updatedEpisode.title,
            releaseDate: req.body.releaseDate,
            dateAdded: new Date().toISOString()
          });
        } else if (isFutureRelease && releaseIndex !== -1) {
          // Update existing scheduled release
          scheduledReleases[releaseIndex].releaseDate = req.body.releaseDate;
          scheduledReleases[releaseIndex].lastUpdated = new Date().toISOString();
          
          // Update title if changed
          if (req.body.title) {
            scheduledReleases[releaseIndex].episodeTitle = req.body.title;
          }
        } else if (!isFutureRelease && releaseIndex !== -1) {
          // Remove scheduled release
          scheduledReleases.splice(releaseIndex, 1);
        }
        
        await writeDataWithLock(SCHEDULED_RELEASES_FILE, scheduledReleases);
      }
      
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
app.delete('/api/anime/:id', async (req, res) => {
  try {
    const animeId = req.params.id;
    let customAnimeList = readData(CUSTOM_ANIME_FILE);
    let episodes = readData(EPISODES_FILE);
    let scheduledReleases = readData(SCHEDULED_RELEASES_FILE);
    
    // Check if anime exists
    const animeIndex = customAnimeList.findIndex(a => a.id === animeId);
    
    if (animeIndex === -1) {
      return res.status(404).json({ error: 'Anime not found' });
    }
    
    // Get episodes for this anime (needed for scheduled releases cleanup)
    const animeEpisodes = episodes.filter(e => e.animeId === animeId);
    const episodeIds = animeEpisodes.map(e => e.id);
    
    // Remove from custom list
    customAnimeList.splice(animeIndex, 1);
    
    // Remove associated episodes
    episodes = episodes.filter(e => e.animeId !== animeId);
    
    // Remove from scheduled releases
    scheduledReleases = scheduledReleases.filter(r => 
      !(r.type === 'anime' && r.id === animeId) && 
      !(r.type === 'episode' && r.animeId === animeId)
    );
    
    // Clear from cache
    animeCache.delete(animeId);
    
    // Write all changes with locking
    const writeResults = await Promise.all([
      writeDataWithLock(CUSTOM_ANIME_FILE, customAnimeList),
      writeDataWithLock(EPISODES_FILE, episodes),
      writeDataWithLock(SCHEDULED_RELEASES_FILE, scheduledReleases)
    ]);
    
    if (writeResults.every(Boolean)) {
      res.json({ 
        message: 'Anime and associated episodes removed successfully',
        removedEpisodes: episodeIds.length
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
app.delete('/api/episodes/:id', async (req, res) => {
  try {
    const episodeId = req.params.id;
    let episodes = readData(EPISODES_FILE);
    
    const episodeIndex = episodes.findIndex(e => e.id === episodeId);
    
    if (episodeIndex === -1) {
      return res.status(404).json({ error: 'Episode not found' });
    }
    
    // Save episode info before removal
    const removedEpisode = episodes[episodeIndex];
    
    // Remove episode
    episodes.splice(episodeIndex, 1);
    
    // Also remove from scheduled releases if needed
    let scheduledReleases = readData(SCHEDULED_RELEASES_FILE);
    const releaseIndex = scheduledReleases.findIndex(r => 
      r.type === 'episode' && r.id === episodeId
    );
    
    if (releaseIndex !== -1) {
      scheduledReleases.splice(releaseIndex, 1);
    }
    
    // Write changes with locking
    const writeResults = await Promise.all([
      writeDataWithLock(EPISODES_FILE, episodes),
      writeDataWithLock(SCHEDULED_RELEASES_FILE, scheduledReleases)
    ]);
    
    if (writeResults.every(Boolean)) {
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
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Query parameter required' });
  }
  
  try {
    const anilistData = await makeAnilistRequest(searchAnimeQuery, { search: query });
    
    // Format the data
    const searchResults = formatSearchResults(anilistData);
    
    // Filter out adult content (optional, can be removed if adult content is allowed)
    const filteredResults = searchResults.filter(anime => !anime.isAdult);
    
    res.json(filteredResults);
  } catch (error) {
    console.error("Error searching anime:", error);
    res.status(500).json({ error: 'Failed to search anime', details: error.message });
  }
});

// Export data
app.get('/api/export', (req, res) => {
  try {
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    const episodes = readData(EPISODES_FILE);
    const scheduledReleases = readData(SCHEDULED_RELEASES_FILE);
    
    const exportData = {
      anime: customAnimeList,
      episodes,
      scheduledReleases,
      exportDate: new Date().toISOString(),
      exportVersion: "1.1"
    };
    
    res.json(exportData);
  } catch (error) {
    console.error("Error exporting data:", error);
    res.status(500).json({ error: 'Failed to export data', details: error.message });
  }
});

// Import data
app.post('/api/import', async (req, res) => {
  try {
    const { anime, episodes, scheduledReleases } = req.body;
    
    if (!anime || !episodes) {
      return res.status(400).json({ error: 'Invalid import data. Both anime and episodes are required.' });
    }
    
    // Validate data
    if (!Array.isArray(anime) || !Array.isArray(episodes)) {
      return res.status(400).json({ error: 'Invalid import format. Anime and episodes must be arrays.' });
    }
    
    // Write data with locking
    const writeResults = await Promise.all([
      writeDataWithLock(CUSTOM_ANIME_FILE, anime),
      writeDataWithLock(EPISODES_FILE, episodes)
    ]);
    
    // Also import scheduled releases if provided
    if (Array.isArray(scheduledReleases)) {
      await writeDataWithLock(SCHEDULED_RELEASES_FILE, scheduledReleases);
    }
    
    if (writeResults.every(Boolean)) {
      // Clear cache to reload from fresh data
      animeCache.clear();
      
      res.json({ 
        success: true, 
        message: 'Data imported successfully',
        counts: {
          anime: anime.length,
          episodes: episodes.length,
          scheduledReleases: scheduledReleases ? scheduledReleases.length : 0
        }
      });
    } else {
      res.status(500).json({ error: 'Failed to import data' });
    }
  } catch (error) {
    console.error("Error importing data:", error);
    res.status(500).json({ error: 'Failed to import data', details: error.message });
  }
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  try {
    // Check if we can read from data files
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    const episodes = readData(EPISODES_FILE);
    
    res.status(200).json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      counts: {
        anime: customAnimeList.length,
        episodes: episodes.length
      }
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
  // Consider enabling this in production to automatically recover from crashes
  // process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
