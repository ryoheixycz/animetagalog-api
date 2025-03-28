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
app.use(bodyParser.json());
app.use(express.static('public'));

// Data file paths - use environment variable for data directory in production
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const EPISODES_FILE = path.join(DATA_DIR, 'episodes.json');
const CUSTOM_ANIME_FILE = path.join(DATA_DIR, 'custom_anime.json');
const SCHEDULED_ANIME_FILE = path.join(DATA_DIR, 'scheduled_anime.json'); // New file for scheduled anime

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
initializeDataFile(SCHEDULED_ANIME_FILE, []); // Initialize scheduled anime file

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
        // Create a backup of the file before writing
        if (fs.existsSync(filePath)) {
            const backupPath = `${filePath}.backup`;
            fs.copyFileSync(filePath, backupPath);
        }
        
        // Write the data to a temporary file first
        const tempPath = `${filePath}.temp`;
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
        
        // Rename the temporary file to the actual file (atomic operation)
        fs.renameSync(tempPath, filePath);
        
        return true;
    } catch (error) {
        console.error(`Error writing to ${filePath}:`, error);
        
        // Try to restore from backup if write failed
        try {
            const backupPath = `${filePath}.backup`;
            if (fs.existsSync(backupPath)) {
                fs.copyFileSync(backupPath, filePath);
                console.log(`Restored ${filePath} from backup`);
            }
        } catch (backupError) {
            console.error(`Failed to restore backup for ${filePath}:`, backupError);
        }
        
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
      extraLarge
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
        extraLarge
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

// Format anime data from AniList - now using higher quality images
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
    // Use extraLarge image when available for higher quality
    thumbnail: media.coverImage?.extraLarge || media.coverImage?.large || "",
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

// Format search results from AniList - now using higher quality images
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
      // Use extraLarge image when available for higher quality
      thumbnail: media.coverImage?.extraLarge || media.coverImage?.large || "",
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

// Load data files on startup
let customAnimeList = [];
let episodes = [];
let scheduledAnime = [];

try {
    console.log("Loading custom anime list from disk...");
    customAnimeList = readData(CUSTOM_ANIME_FILE);
    console.log(`Loaded ${customAnimeList.length} custom anime entries`);
    
    console.log("Loading episodes from disk...");
    episodes = readData(EPISODES_FILE);
    console.log(`Loaded ${episodes.length} episodes`);
    
    console.log("Loading scheduled anime from disk...");
    scheduledAnime = readData(SCHEDULED_ANIME_FILE);
    console.log(`Loaded ${scheduledAnime.length} scheduled anime entries`);
} catch (error) {
    console.error("Error loading data files:", error);
}

// Data sync interval (save to disk every 5 minutes)
const syncInterval = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
    console.log("Syncing data to disk...");
    writeData(CUSTOM_ANIME_FILE, customAnimeList);
    writeData(EPISODES_FILE, episodes);
    writeData(SCHEDULED_ANIME_FILE, scheduledAnime);
    console.log("Data sync complete");
}, syncInterval);

// API Routes
// Get all anime (from custom list)
app.get('/api/anime', async (req, res) => {
  try {
    // Use the in-memory list instead of reading from disk every time
    
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
          
          // Add tagalog dub info from our stored data
          if (animeInfo.hasTagalogDub !== undefined) {
            animeDetail.hasTagalogDub = animeInfo.hasTagalogDub;
          } else {
            animeDetail.hasTagalogDub = false; // Default value
          }
          
          // Cache the result
          animeCache.set(animeInfo.id, animeDetail);
        } catch (error) {
          // If AniList fails, use our stored custom data
          animeDetail = animeInfo;
          console.error(`Failed to fetch anime details for ID ${animeInfo.id}:`, error.message);
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

// Get tagalog dubbed anime only
app.get('/api/anime/tagalog', async (req, res) => {
  try {
    // Use the in-memory list instead of reading from disk
    
    // Filter for anime with tagalog dub
    const tagalogAnimeIds = customAnimeList
      .filter(anime => anime.hasTagalogDub === true)
      .map(anime => anime.id);
    
    const animeDetails = [];
    
    for (const animeId of tagalogAnimeIds) {
      let animeDetail = null;
      
      // Check cache first
      if (animeCache.has(animeId)) {
        animeDetail = animeCache.get(animeId);
      } else {
        try {
          const response = await axios.post(ANILIST_API, {
            query: getAnimeQuery,
            variables: { id: parseInt(animeId) }
          });
          
          // Format the data
          animeDetail = formatAnimeData(response.data);
          animeDetail.hasTagalogDub = true;
          
          // Cache the result
          animeCache.set(animeId, animeDetail);
        } catch (error) {
          // If AniList fails, use our stored custom data
          const storedAnime = customAnimeList.find(a => a.id === animeId);
          if (storedAnime) {
            animeDetail = storedAnime;
          } else {
            continue; // Skip this anime if we can't get details
          }
        }
      }
      
      animeDetails.push(animeDetail);
    }
    
    res.json(animeDetails);
  } catch (error) {
    console.error("Error fetching Tagalog anime list:", error);
    res.status(500).json({ error: 'Failed to fetch Tagalog anime list' });
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
      
      // Check if there's tagalog dub info in custom anime list
      const storedAnime = customAnimeList.find(a => a.id === animeId);
      if (storedAnime && storedAnime.hasTagalogDub !== undefined) {
        animeDetail.hasTagalogDub = storedAnime.hasTagalogDub;
      } else {
        animeDetail.hasTagalogDub = false; // Default value
      }
      
      // Cache the result
      animeCache.set(animeId, animeDetail);
      
      res.json(animeDetail);
    } catch (anilistError) {
      // If AniList API fails, check our custom data
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
  // Use in-memory data instead of reading from disk
  res.json(episodes);
});

// Get episodes for an anime
app.get('/api/anime/:id/episodes', (req, res) => {
  const animeId = req.params.id;
  // Use in-memory data instead of reading from disk
  const animeEpisodes = episodes.filter(e => e.animeId === animeId);
  
  res.json(animeEpisodes);
});

// Get specific episode
app.get('/api/episodes/:id', (req, res) => {
  const episodeId = req.params.id;
  // Use in-memory data instead of reading from disk
  const foundEpisode = episodes.find(e => e.id === episodeId);
  
  if (!foundEpisode) {
    return res.status(404).json({ error: 'Episode not found' });
  }
  
  res.json(foundEpisode);
});

// Get scheduled anime releases
app.get('/api/scheduled', (req, res) => {
  // Use in-memory data instead of reading from disk
  
  // Sort by release date (ascending)
  const sortedSchedule = [...scheduledAnime].sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
  
  res.json(sortedSchedule);
});

// Get upcoming releases (for integration with other sites)
app.get('/api/upcoming', (req, res) => {
  // Use in-memory data instead of reading from disk
  const now = new Date();
  
  // Filter for upcoming releases only
  const upcomingReleases = scheduledAnime
    .filter(item => new Date(item.releaseDate) > now)
    .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
  
  res.json(upcomingReleases);
});

// Search for anime in the library (instead of AniList)
app.get('/api/library/search', (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: 'Query parameter required' });
  }
  
  try {
    // Search through in-memory cache of anime
    const searchTerm = query.toLowerCase();
    const matchingAnime = [];
    
    for (const animeInfo of customAnimeList) {
      const animeDetail = animeCache.get(animeInfo.id);
      
      if (animeDetail) {
        const title = animeDetail.title?.toLowerCase() || '';
        const titleRomaji = animeDetail.titleRomaji?.toLowerCase() || '';
        
        if (title.includes(searchTerm) || titleRomaji.includes(searchTerm)) {
          matchingAnime.push(animeDetail);
        }
      }
    }
    
    res.json(matchingAnime);
  } catch (error) {
    console.error("Error searching library:", error);
    res.status(500).json({ error: 'Failed to search anime library' });
  }
});

// Add anime to custom list
app.post('/api/anime', async (req, res) => {
  try {
    const { anilistId, hasTagalogDub } = req.body;
    
    if (!anilistId) {
      return res.status(400).json({ error: 'AniList ID is required' });
    }
    
    // Check if anime already exists in our list
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
    
    // Add to our custom list with Tagalog dub info
    const newAnimeEntry = { 
      id: anilistId.toString(),
      hasTagalogDub: hasTagalogDub === true
    };
    
    customAnimeList.push(newAnimeEntry);
    
    // Write to disk immediately to prevent data loss
    if (writeData(CUSTOM_ANIME_FILE, customAnimeList)) {
      // Add tagalog dub info
      animeDetail.hasTagalogDub = hasTagalogDub === true;
      
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
  // Check if anime exists in our list
  const animeExists = customAnimeList.some(a => a.id === req.body.animeId);
  
  if (!animeExists) {
    return res.status(404).json({ error: 'Anime not found in our list' });
  }
  
  // Get existing episodes to determine the next episode number
  const existingEpisodes = episodes.filter(e => e.animeId === req.body.animeId);
  const nextEpisodeNumber = req.body.number || (existingEpisodes.length > 0 
    ? Math.max(...existingEpisodes.map(e => e.number)) + 1 
    : 1);
  
  // Auto-generate episode title if not provided
  const episodeTitle = req.body.title || `Episode ${nextEpisodeNumber}`;
  
  const newEpisode = {
    id: Date.now().toString(),
    animeId: req.body.animeId,
    title: episodeTitle,
    number: nextEpisodeNumber,
    iframeSrc: req.body.iframeSrc || "",
    server2Url: req.body.server2Url || "",
    hasTagalogDub: req.body.hasTagalogDub === true,
    dateAdded: new Date().toISOString()
  };
  
  episodes.push(newEpisode);
  
  // Write to disk immediately to prevent data loss
  if (writeData(EPISODES_FILE, episodes)) {
    // Update anime's Tagalog dub status if this episode has Tagalog dub
    if (req.body.hasTagalogDub === true) {
      const animeIndex = customAnimeList.findIndex(a => a.id === req.body.animeId);
      if (animeIndex !== -1) {
        customAnimeList[animeIndex].hasTagalogDub = true;
        writeData(CUSTOM_ANIME_FILE, customAnimeList);
        
        // Update cache if exists
        if (animeCache.has(req.body.animeId)) {
          const cachedAnime = animeCache.get(req.body.animeId);
          cachedAnime.hasTagalogDub = true;
          animeCache.set(req.body.animeId, cachedAnime);
        }
      }
    }
    
    res.status(201).json(newEpisode);
  } else {
    res.status(500).json({ error: 'Failed to add episode' });
  }
});

// Add scheduled anime
app.post('/api/scheduled', async (req, res) => {
  try {
    const { anilistId, releaseDate, notes, hasTagalogDub } = req.body;
    
    if (!anilistId) {
      return res.status(400).json({ error: 'AniList ID is required' });
    }
    
    if (!releaseDate) {
      return res.status(400).json({ error: 'Release date is required' });
    }
    
    // Validate date format
    if (isNaN(new Date(releaseDate).getTime())) {
      return res.status(400).json({ error: 'Invalid release date format' });
    }
    
    // Fetch anime details from AniList to confirm it exists
    const response = await axios.post(ANILIST_API, {
      query: getAnimeQuery,
      variables: { id: parseInt(anilistId) }
    });
    
    // Format the data
    const animeDetail = formatAnimeData(response.data);
    
    // Add to scheduled releases
    const newScheduledAnime = {
      id: Date.now().toString(),
      animeId: anilistId.toString(),
      title: animeDetail.title,
      thumbnail: animeDetail.thumbnail,
      releaseDate: releaseDate,
      notes: notes || "",
      hasTagalogDub: hasTagalogDub === true,
      dateAdded: new Date().toISOString()
    };
    
    scheduledAnime.push(newScheduledAnime);
    
    // Write to disk immediately to prevent data loss
    if (writeData(SCHEDULED_ANIME_FILE, scheduledAnime)) {
      res.status(201).json(newScheduledAnime);
    } else {
      res.status(500).json({ error: 'Failed to add scheduled anime' });
    }
  } catch (error) {
    console.error("Error adding scheduled anime:", error);
    
    if (error.response && error.response.data) {
      return res.status(400).json({ error: 'Invalid AniList ID or API error', details: error.response.data });
    }
    
    res.status(500).json({ error: 'Failed to add scheduled anime' });
  }
});

// Update episode
app.put('/api/episodes/:id', (req, res) => {
  const episodeId = req.params.id;
  const episodeIndex = episodes.findIndex(e => e.id === episodeId);
  
  if (episodeIndex === -1) {
    return res.status(404).json({ error: 'Episode not found' });
  }
  
  episodes[episodeIndex] = {
    ...episodes[episodeIndex],
    ...req.body,
    id: episodeId // Ensure ID remains the same
  };
  
  // Check if this is setting Tagalog dub for the first time
  if (req.body.hasTagalogDub === true && episodes[episodeIndex].hasTagalogDub !== true) {
    const animeIndex = customAnimeList.findIndex(a => a.id === episodes[episodeIndex].animeId);
    
    if (animeIndex !== -1) {
      customAnimeList[animeIndex].hasTagalogDub = true;
      writeData(CUSTOM_ANIME_FILE, customAnimeList);
      
      // Update cache if exists
      if (animeCache.has(episodes[episodeIndex].animeId)) {
        const cachedAnime = animeCache.get(episodes[episodeIndex].animeId);
        cachedAnime.hasTagalogDub = true;
        animeCache.set(episodes[episodeIndex].animeId, cachedAnime);
      }
    }
  }
  
  // Write to disk immediately
  if (writeData(EPISODES_FILE, episodes)) {
    res.json(episodes[episodeIndex]);
  } else {
    res.status(500).json({ error: 'Failed to update episode' });
  }
});

// Update scheduled anime
app.put('/api/scheduled/:id', async (req, res) => {
  const scheduleId = req.params.id;
  const scheduleIndex = scheduledAnime.findIndex(s => s.id === scheduleId);
  
  if (scheduleIndex === -1) {
    return res.status(404).json({ error: 'Scheduled anime not found' });
  }
  
  // Validate date format if provided
  if (req.body.releaseDate && isNaN(new Date(req.body.releaseDate).getTime())) {
    return res.status(400).json({ error: 'Invalid release date format' });
  }
  
  scheduledAnime[scheduleIndex] = {
    ...scheduledAnime[scheduleIndex],
    ...req.body,
    id: scheduleId // Ensure ID remains the same
  };
  
  // Write to disk immediately
  if (writeData(SCHEDULED_ANIME_FILE, scheduledAnime)) {
    res.json(scheduledAnime[scheduleIndex]);
  } else {
    res.status(500).json({ error: 'Failed to update scheduled anime' });
  }
});

// Update anime Tagalog dub status
app.put('/api/anime/:id/tagalog', (req, res) => {
  const animeId = req.params.id;
  const { hasTagalogDub } = req.body;
  
  if (hasTagalogDub === undefined) {
    return res.status(400).json({ error: 'hasTagalogDub field is required' });
  }
  
  const animeIndex = customAnimeList.findIndex(a => a.id === animeId);
  
  if (animeIndex === -1) {
    return res.status(404).json({ error: 'Anime not found' });
  }
  
  // Update the Tagalog dub status
  customAnimeList[animeIndex].hasTagalogDub = hasTagalogDub === true;
  
  // Write to disk immediately
  if (writeData(CUSTOM_ANIME_FILE, customAnimeList)) {
    // Update cache if exists
    if (animeCache.has(animeId)) {
      const cachedAnime = animeCache.get(animeId);
      cachedAnime.hasTagalogDub = hasTagalogDub === true;
      animeCache.set(animeId, cachedAnime);
    }
    
    res.json({ id: animeId, hasTagalogDub: hasTagalogDub === true });
  } else {
    res.status(500).json({ error: 'Failed to update anime' });
  }
});

// Remove anime from list
app.delete('/api/anime/:id', (req, res) => {
  const animeId = req.params.id;
  
  // Remove from custom list
  customAnimeList = customAnimeList.filter(a => a.id !== animeId);
  
  // Remove associated episodes
  episodes = episodes.filter(e => e.animeId !== animeId);
  
  // Remove from scheduled anime
  scheduledAnime = scheduledAnime.filter(s => s.animeId !== animeId);
  
  // Clear from cache
  animeCache.delete(animeId);
  
  // Write to disk immediately
  if (
    writeData(CUSTOM_ANIME_FILE, customAnimeList) && 
    writeData(EPISODES_FILE, episodes) &&
    writeData(SCHEDULED_ANIME_FILE, scheduledAnime)
  ) {
    res.json({ message: 'Anime and associated data removed successfully' });
  } else {
    res.status(500).json({ error: 'Failed to remove anime' });
  }
});

// Delete episode
app.delete('/api/episodes/:id', (req, res) => {
  const episodeId = req.params.id;
  const episodeIndex = episodes.findIndex(e => e.id === episodeId);
  
  if (episodeIndex === -1) {
    return res.status(404).json({ error: 'Episode not found' });
  }
  
  episodes.splice(episodeIndex, 1);
  
  // Write to disk immediately
  if (writeData(EPISODES_FILE, episodes)) {
    res.json({ message: 'Episode deleted successfully' });
  } else {
    res.status(500).json({ error: 'Failed to delete episode' });
  }
});

// Delete scheduled anime
app.delete('/api/scheduled/:id', (req, res) => {
  const scheduleId = req.params.id;
  const scheduleIndex = scheduledAnime.findIndex(s => s.id === scheduleId);
  
  if (scheduleIndex === -1) {
    return res.status(404).json({ error: 'Scheduled anime not found' });
  }
  
  scheduledAnime.splice(scheduleIndex, 1);
  
  // Write to disk immediately
  if (writeData(SCHEDULED_ANIME_FILE, scheduledAnime)) {
    res.json({ message: 'Scheduled anime deleted successfully' });
  } else {
    res.status(500).json({ error: 'Failed to delete scheduled anime' });
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
  const exportData = {
    anime: customAnimeList,
    episodes,
    scheduled: scheduledAnime,
    exportDate: new Date().toISOString(),
    exportVersion: "1.1"
  };
  
  res.json(exportData);
});

// Import data endpoint
app.post('/api/import', (req, res) => {
  try {
    const importData = req.body;
    
    if (!importData || typeof importData !== 'object') {
      return res.status(400).json({ error: 'Invalid import data format' });
    }
    
    // Validate the import data structure
    if (!Array.isArray(importData.anime) || !Array.isArray(importData.episodes) || !Array.isArray(importData.scheduled)) {
      return res.status(400).json({ error: 'Import data missing required arrays' });
    }
    
    // Update in-memory data
    customAnimeList = importData.anime;
    episodes = importData.episodes;
    scheduledAnime = importData.scheduled;
    
    // Clear cache to force refresh
    animeCache.clear();
    
    // Write to disk immediately
    if (
      writeData(CUSTOM_ANIME_FILE, customAnimeList) && 
      writeData(EPISODES_FILE, episodes) &&
      writeData(SCHEDULED_ANIME_FILE, scheduledAnime)
    ) {
      res.json({ 
        message: 'Import successful', 
        counts: {
          anime: customAnimeList.length,
          episodes: episodes.length,
          scheduled: scheduledAnime.length
        } 
      });
    } else {
      res.status(500).json({ error: 'Failed to write imported data to disk' });
    }
  } catch (error) {
    console.error("Error importing data:", error);
    res.status(500).json({ error: 'Failed to import data: ' + error.message });
  }
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  const dataStatus = {
    customAnimeCount: customAnimeList.length,
    episodesCount: episodes.length,
    scheduledCount: scheduledAnime.length,
    cacheSize: animeCache.size
  };
  
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    dataStats: dataStatus
  });
});

// Handle SPA routing for admin panel
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`API Documentation: http://${HOST}:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});

// Handle errors gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  
  // Try to save data on critical error
  try {
    console.log("Attempting to save data before shutdown due to uncaught exception...");
    writeData(CUSTOM_ANIME_FILE, customAnimeList);
    writeData(EPISODES_FILE, episodes);
    writeData(SCHEDULED_ANIME_FILE, scheduledAnime);
    console.log("Emergency data save completed");
  } catch (saveError) {
    console.error("Failed to save data during shutdown:", saveError);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Clean up resources before shutdown
process.on('SIGINT', () => {
  console.log('Server shutting down...');
  
  // Save all data before exit
  console.log("Saving data before shutdown...");
  writeData(CUSTOM_ANIME_FILE, customAnimeList);
  writeData(EPISODES_FILE, episodes);
  writeData(SCHEDULED_ANIME_FILE, scheduledAnime);
  console.log("Final data save completed");
  
  process.exit(0);
});

// Schedule automatic health check (run every 5 minutes)
setInterval(() => {
  axios.get(`http://${HOST}:${PORT}/health`)
    .then(response => {
      if (response.data.status === 'ok') {
        console.log(`Health check passed at ${response.data.timestamp}`);
        console.log(`Data stats: ${JSON.stringify(response.data.dataStats)}`);
      } else {
        console.error('Health check failed');
      }
    })
    .catch(error => {
      console.error('Health check error:', error.message);
    });
}, 300000); // 5 minutes in milliseconds

// Data backup job (every 24 hours)
const backupInterval = 24 * 60 * 60 * 1000; // 24 hours
setInterval(() => {
  console.log("Running scheduled data backup...");
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(DATA_DIR, 'backups', timestamp);
  
  try {
    // Create backup directory
    fs.mkdirSync(backupDir, { recursive: true });
    
    // Copy data files to backup
    fs.copyFileSync(CUSTOM_ANIME_FILE, path.join(backupDir, 'custom_anime.json'));
    fs.copyFileSync(EPISODES_FILE, path.join(backupDir, 'episodes.json'));
    fs.copyFileSync(SCHEDULED_ANIME_FILE, path.join(backupDir, 'scheduled_anime.json'));
    
    console.log(`Backup completed to ${backupDir}`);
    
    // Clean up old backups (keep only the last 7)
    const backupsBaseDir = path.join(DATA_DIR, 'backups');
    if (fs.existsSync(backupsBaseDir)) {
      const backupFolders = fs.readdirSync(backupsBaseDir)
        .filter(f => fs.statSync(path.join(backupsBaseDir, f)).isDirectory())
        .sort((a, b) => b.localeCompare(a)); // Sort descending (newest first)
      
      // Delete older backups beyond the 7th one
      if (backupFolders.length > 7) {
        backupFolders.slice(7).forEach(folder => {
          const folderPath = path.join(backupsBaseDir, folder);
          fs.rmSync(folderPath, { recursive: true, force: true });
          console.log(`Removed old backup: ${folderPath}`);
        });
      }
    }
  } catch (error) {
    console.error("Backup operation failed:", error);
  }
}, backupInterval);
