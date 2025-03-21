const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Data file paths
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const EPISODES_FILE = path.join(DATA_DIR, 'episodes.json');
const CUSTOM_ANIME_FILE = path.join(DATA_DIR, 'custom_anime.json');
const SCHEDULED_ANIME_FILE = path.join(DATA_DIR, 'scheduled_anime.json');

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
initializeDataFile(SCHEDULED_ANIME_FILE, []);

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

// GraphQL query to get anime details - Enhanced with higher quality images
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
    tags {
      name
      category
      rank
    }
    coverImage {
      large
      extraLarge
      medium
      color
    }
    bannerImage
    averageScore
    meanScore
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
    seasonYear
    format
    source
    studios {
      nodes {
        name
        isAnimationStudio
      }
    }
    relations {
      edges {
        relationType
        node {
          id
          title {
            romaji
          }
          type
          format
          coverImage {
            medium
          }
        }
      }
    }
    airingSchedule {
      nodes {
        episode
        airingAt
        timeUntilAiring
      }
    }
    countryOfOrigin
    isAdult
    trailer {
      site
      id
      thumbnail
    }
    externalLinks {
      site
      url
    }
    nextAiringEpisode {
      episode
      airingAt
      timeUntilAiring
    }
  }
}
`;

const searchAnimeQuery = `
query ($search: String, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      total
      currentPage
      lastPage
      hasNextPage
      perPage
    }
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
        medium
        color
      }
      bannerImage
      averageScore
      popularity
      episodes
      duration
      status
      format
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
      seasonYear
      studios {
        nodes {
          name
        }
      }
      nextAiringEpisode {
        episode
        airingAt
        timeUntilAiring
      }
      countryOfOrigin
      isAdult
    }
  }
}
`;

// Format anime data from AniList with enhanced details and HD images
const formatAnimeData = (anilistData) => {
  const media = anilistData.data.Media;
  
  // Format date
  const formatDate = (dateObj) => {
    if (!dateObj || !dateObj.year) return null;
    return `${dateObj.year}-${dateObj.month?.toString().padStart(2, '0') || '01'}-${dateObj.day?.toString().padStart(2, '0') || '01'}`;
  };
  
  // Format airing time
  const formatAiringTime = (timestamp) => {
    if (!timestamp) return null;
    return new Date(timestamp * 1000).toISOString();
  };
  
  // Get YouTube trailer URL if available
  const getTrailerUrl = (trailer) => {
    if (!trailer || !trailer.id) return null;
    if (trailer.site === 'youtube') return `https://www.youtube.com/watch?v=${trailer.id}`;
    return null;
  };

  // Get trailer thumbnail
  const getTrailerThumbnail = (trailer) => {
    if (!trailer || !trailer.id) return null;
    if (trailer.site === 'youtube') return `https://img.youtube.com/vi/${trailer.id}/hqdefault.jpg`;
    if (trailer.thumbnail) return trailer.thumbnail;
    return null;
  };
  
  return {
    id: media.id.toString(),
    title: media.title.english || media.title.romaji,
    titleRomaji: media.title.romaji,
    titleNative: media.title.native,
    description: media.description?.replace(/<br>/g, '\n').replace(/<\/?[^>]+(>|$)/g, "") || "",
    genres: media.genres || [],
    tags: media.tags?.map(tag => ({
      name: tag.name,
      category: tag.category,
      rank: tag.rank
    })) || [],
    // Use extraLarge image by default for HD quality
    thumbnail: media.coverImage?.extraLarge || media.coverImage?.large || "",
    thumbnailLarge: media.coverImage?.large || "",
    thumbnailMedium: media.coverImage?.medium || "",
    imageExtraLarge: media.coverImage?.extraLarge || "",
    imageBanner: media.bannerImage || "",
    imageColor: media.coverImage?.color || "#808080",
    rating: media.averageScore / 10 || 0,
    meanScore: media.meanScore || 0,
    popularity: media.popularity || 0,
    episodeCount: media.episodes?.toString() || "Unknown",
    episodeLength: media.duration?.toString() || "Unknown",
    status: media.status || "Unknown",
    format: media.format || "Unknown",
    source: media.source || "Unknown",
    startDate: formatDate(media.startDate),
    endDate: formatDate(media.endDate),
    season: media.season || "Unknown",
    seasonYear: media.seasonYear || null,
    studios: media.studios?.nodes?.map(studio => ({
      name: studio.name,
      isAnimationStudio: studio.isAnimationStudio
    })) || [],
    relations: media.relations?.edges?.map(relation => ({
      type: relation.relationType,
      id: relation.node.id,
      title: relation.node.title.romaji,
      mediaType: relation.node.type,
      format: relation.node.format,
      thumbnail: relation.node.coverImage?.medium || ""
    })) || [],
    airingSchedule: media.airingSchedule?.nodes?.map(node => ({
      episode: node.episode,
      airingAt: formatAiringTime(node.airingAt),
      timeUntilAiring: node.timeUntilAiring
    })) || [],
    nextAiring: media.nextAiringEpisode ? {
      episode: media.nextAiringEpisode.episode,
      airingAt: formatAiringTime(media.nextAiringEpisode.airingAt),
      timeUntilAiring: media.nextAiringEpisode.timeUntilAiring
    } : null,
    country: media.countryOfOrigin || "Unknown",
    isAdult: media.isAdult || false,
    trailer: getTrailerUrl(media.trailer),
    trailerThumbnail: getTrailerThumbnail(media.trailer),
    externalLinks: media.externalLinks?.map(link => ({
      site: link.site,
      url: link.url
    })) || [],
    dateAdded: new Date().toISOString()
  };
};

// Format search results with enhanced details and HD images
const formatSearchResults = (anilistData) => {
  return anilistData.data.Page.media.map(media => {
    // Format date
    const formatDate = (dateObj) => {
      if (!dateObj || !dateObj.year) return null;
      return `${dateObj.year}-${dateObj.month?.toString().padStart(2, '0') || '01'}-${dateObj.day?.toString().padStart(2, '0') || '01'}`;
    };
    
    // Format airing time
    const formatAiringTime = (timestamp) => {
      if (!timestamp) return null;
      return new Date(timestamp * 1000).toISOString();
    };
    
    return {
      id: media.id.toString(),
      title: media.title.english || media.title.romaji,
      titleRomaji: media.title.romaji,
      titleNative: media.title.native,
      description: media.description?.replace(/<br>/g, '\n').replace(/<\/?[^>]+(>|$)/g, "") || "",
      genres: media.genres || [],
      // Use extraLarge image by default for HD quality
      thumbnail: media.coverImage?.extraLarge || media.coverImage?.large || "",
      thumbnailLarge: media.coverImage?.large || "",
      thumbnailMedium: media.coverImage?.medium || "",
      imageExtraLarge: media.coverImage?.extraLarge || "",
      imageBanner: media.bannerImage || "",
      imageColor: media.coverImage?.color || "#808080",
      rating: media.averageScore / 10 || 0,
      popularity: media.popularity || 0,
      episodeCount: media.episodes?.toString() || "Unknown",
      episodeLength: media.duration?.toString() || "Unknown",
      status: media.status || "Unknown",
      format: media.format || "Unknown",
      startDate: formatDate(media.startDate),
      endDate: formatDate(media.endDate),
      season: media.season || "Unknown",
      seasonYear: media.seasonYear || null,
      studios: media.studios?.nodes?.map(studio => studio.name) || [],
      nextAiring: media.nextAiringEpisode ? {
        episode: media.nextAiringEpisode.episode,
        airingAt: formatAiringTime(media.nextAiringEpisode.airingAt),
        timeUntilAiring: media.nextAiringEpisode.timeUntilAiring
      } : null,
      country: media.countryOfOrigin || "Unknown",
      isAdult: media.isAdult || false
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

// Get trending/seasonal anime
app.get('/api/trending', async (req, res) => {
  try {
    const seasonalQuery = `
      query ($season: MediaSeason, $seasonYear: Int, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) {
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
              medium
              color
            }
            bannerImage
            averageScore
            popularity
            episodes
            status
            season
            seasonYear
            nextAiringEpisode {
              episode
              airingAt
              timeUntilAiring
            }
          }
        }
      }
    `;
    
    // Get current season
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    
    let season;
    if (month >= 0 && month <= 2) season = "WINTER";
    else if (month >= 3 && month <= 5) season = "SPRING";
    else if (month >= 6 && month <= 8) season = "SUMMER";
    else season = "FALL";

    const response = await axios.post(ANILIST_API, {
      query: seasonalQuery,
      variables: { 
        season: season,
        seasonYear: year,
        page: 1,
        perPage: 20
      }
    });
    
    const results = response.data.data.Page.media.map(media => {
      return {
        id: media.id.toString(),
        title: media.title.english || media.title.romaji,
        titleRomaji: media.title.romaji,
        // Use extraLarge image by default for HD quality
        thumbnail: media.coverImage?.extraLarge || media.coverImage?.large || "",
        thumbnailLarge: media.coverImage?.large || "",
        thumbnailMedium: media.coverImage?.medium || "",
        imageColor: media.coverImage?.color || "#808080",
        rating: media.averageScore / 10 || 0,
        popularity: media.popularity || 0,
        episodeCount: media.episodes || "?",
        status: media.status || "Unknown",
        season: `${media.season} ${media.seasonYear}`
      };
    });
    
    res.json(results);
  } catch (error) {
    console.error("Error fetching trending anime:", error);
    res.status(500).json({ error: 'Failed to fetch trending anime' });
  }
});

// Get single anime by ID with enhanced fields
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

// Get episodes for an anime
app.get('/api/anime/:id/episodes', (req, res) => {
  const animeId = req.params.id;
  const episodes = readData(EPISODES_FILE);
  const animeEpisodes = episodes.filter(e => e.animeId === animeId);
  
  res.json(animeEpisodes);
});

// Get scheduled anime
app.get('/api/scheduled', (req, res) => {
  const scheduledAnime = readData(SCHEDULED_ANIME_FILE);
  res.json(scheduledAnime);
});

// Add anime to scheduled list
app.post('/api/scheduled', async (req, res) => {
  try {
    const { anilistId, scheduledDate, customNote } = req.body;
    
    if (!anilistId) {
      return res.status(400).json({ error: 'AniList ID is required' });
    }
    
    if (!scheduledDate) {
      return res.status(400).json({ error: 'Scheduled date is required' });
    }
    
    // Validate date format
    const dateObj = new Date(scheduledDate);
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    // Fetch anime details from AniList
    let animeDetail;
    try {
      const response = await axios.post(ANILIST_API, {
        query: getAnimeQuery,
        variables: { id: parseInt(anilistId) }
      });
      
      // Format the data
      animeDetail = formatAnimeData(response.data);
    } catch (error) {
      return res.status(400).json({ error: 'Failed to fetch anime details from AniList' });
    }
    
    const scheduledAnime = readData(SCHEDULED_ANIME_FILE);
    
    // Check if already scheduled
    const existingEntry = scheduledAnime.find(a => a.anilistId === anilistId.toString());
    
    const newScheduledEntry = {
      id: existingEntry ? existingEntry.id : Date.now().toString(),
      anilistId: anilistId.toString(),
      title: animeDetail.title,
      thumbnail: animeDetail.thumbnail, // Using HD image
      scheduledDate: scheduledDate,
      customNote: customNote || '',
      dateAdded: new Date().toISOString()
    };
    
    if (existingEntry) {
      // Update existing entry
      const index = scheduledAnime.findIndex(a => a.id === existingEntry.id);
      scheduledAnime[index] = newScheduledEntry;
    } else {
      // Add new entry
      scheduledAnime.push(newScheduledEntry);
    }
    
    if (writeData(SCHEDULED_ANIME_FILE, scheduledAnime)) {
      res.status(201).json(newScheduledEntry);
    } else {
      res.status(500).json({ error: 'Failed to add anime to scheduled list' });
    }
  } catch (error) {
    console.error("Error scheduling anime:", error);
    res.status(500).json({ error: 'Failed to schedule anime' });
  }
});

// Delete scheduled anime
app.delete('/api/scheduled/:id', (req, res) => {
  const scheduledId = req.params.id;
  let scheduledAnime = readData(SCHEDULED_ANIME_FILE);
  
  const scheduledIndex = scheduledAnime.findIndex(a => a.id === scheduledId);
  
  if (scheduledIndex === -1) {
    return res.status(404).json({ error: 'Scheduled anime not found' });
  }
  
  scheduledAnime.splice(scheduledIndex, 1);
  
  if (writeData(SCHEDULED_ANIME_FILE, scheduledAnime)) {
    res.json({ message: 'Scheduled anime removed successfully' });
  } else {
    res.status(500).json({ error: 'Failed to remove scheduled anime' });
  }
});

// Enhanced search with pagination and filtering
app.get('/api/search', async (req, res) => {
  const { query, page = 1, perPage = 10, genre, season, year, status } = req.query;
  
  if (!query && !genre && !season && !year && !status) {
    return res.status(400).json({ error: 'At least one search parameter is required' });
  }
  
  try {
    // Build the advanced search query
    const advancedSearchQuery = `
      query ($search: String, $page: Int, $perPage: Int, $genre: String, $season: MediaSeason, $seasonYear: Int, $status: MediaStatus) {
        Page(page: $page, perPage: $perPage) {
          pageInfo {
            total
            currentPage
            lastPage
            hasNextPage
            perPage
          }
          media(search: $search, genre: $genre, season: $season, seasonYear: $seasonYear, status: $status, type: ANIME, sort: POPULARITY_DESC) {
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
              medium
              color
            }
            bannerImage
            averageScore
            popularity
            episodes
            duration
            status
            format
            startDate {
              year
              month
              day
            }
            season
            seasonYear
            nextAiringEpisode {
              episode
              airingAt
              timeUntilAiring
            }
          }
        }
      }
    `;
    
    // Convert season string to enum value
    let seasonEnum = null;
    if (season) {
      seasonEnum = season.toUpperCase();
    }
    
    // Convert status string to enum value
    let statusEnum = null;
    if (status) {
      statusEnum = status.toUpperCase();
    }
    
    const response = await axios.post(ANILIST_API, {
      query: advancedSearchQuery,
      variables: { 
        search: query || undefined,
        page: parseInt(page),
        perPage: parseInt(perPage),
        genre: genre || undefined,
        season: seasonEnum,
        seasonYear: year ? parseInt(year) : undefined,
        status: statusEnum
      }
    });
    
    const searchResults = {
      pageInfo: response.data.data.Page.pageInfo,
      results: response.data.data.Page.media.map(media => {
        // Format date
        const formatDate = (dateObj) => {
          if (!dateObj || !dateObj.year) return null;
          return `${dateObj.year}-${dateObj.month?.toString().padStart(2, '0') || '01'}-${dateObj.day?.toString().padStart(2, '0') || '01'}`;
        };
        
        // Format airing time
        const formatAiringTime = (timestamp) => {
          if (!timestamp) return null;
          return new Date(timestamp * 1000).toISOString();
        };
        
        return {
          id: media.id.toString(),
          title: media.title.english || media.title.romaji,
          titleRomaji: media.title.romaji,
          titleNative: media.title.native,
          description: media.description?.replace(/<br>/g, '\n').replace(/<\/?[^>]+(>|$)/g, "") || "",
          genres: media.genres || [],
          // Use extraLarge image by default for HD quality 
          thumbnail: media.coverImage?.extraLarge || media.coverImage?.large || "",
          thumbnailLarge: media.coverImage?.large || "",
          thumbnailMedium: media.coverImage?.medium || "",
          imageColor: media.coverImage?.color || "#808080",
          banner: media.bannerImage,
          rating: media.averageScore / 10 || 0,
          popularity: media.popularity || 0,
          episodeCount: media.episodes?.toString() || "Unknown",
          episodeLength: media.duration?.toString() || "Unknown",
          status: media.status || "Unknown",
          format: media.format || "Unknown",
          startDate: formatDate(media.startDate),
          season: media.season || "Unknown",
          seasonYear: media.seasonYear || null,
          nextAiring: media.nextAiringEpisode ? {
            episode: media.nextAiringEpisode.episode,
            airingAt: formatAiringTime(media.nextAiringEpisode.airingAt),
            timeUntilAiring: media.nextAiringEpisode.timeUntilAiring
          } : null
        };
      })
    };
    
    res.json(searchResults);
  } catch (error) {
    console.error("Error searching anime:", error);
    res.status(500).json({ error: 'Failed to search anime' });
  }
});

// Get anime genres list
app.get('/api/genres', async (req, res) => {
  try {
    // This is a static list of common anime genres from AniList
    const commonGenres = [
      "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", 
      "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", 
      "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"
    ];
    
    res.json(commonGenres);
  } catch (error) {
    console.error("Error fetching genres:", error);
    res.status(500).json({ error: 'Failed to fetch genres' });
  }
});

// Schedule checker function - manual function instead of cron
function checkScheduledAnime() {
  console.log("Checking scheduled anime...");
  const scheduledAnime = readData(SCHEDULED_ANIME_FILE);
  const now = new Date();
  
  // Find scheduled anime that should be activated today
  const toActivate = scheduledAnime.filter(anime => {
    const scheduleDate = new Date(anime.scheduledDate);
    
    // Compare year, month, and day only
    return scheduleDate.getFullYear() === now.getFullYear() &&
           scheduleDate.getMonth() === now.getMonth() &&
           scheduleDate.getDate() === now.getDate();
  });
  
  if (toActivate.length > 0) {
    console.log(`Found ${toActivate.length} anime to activate today`);
    
    // Add them to the custom anime list if not already there
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    let updated = false;
    
    for (const anime of toActivate) {
      if (!customAnimeList.some(a => a.id === anime.anilistId)) {
        customAnimeList.push({ id: anime.anilistId.toString() });
        updated = true;
      }
    }
    
    if (updated) {
      writeData(CUSTOM_ANIME_FILE, customAnimeList);
    }
  }
}

// Export data
app.get('/api/export', (req, res) => {
  const customAnimeList = readData(CUSTOM_ANIME_FILE);
  const episodes = readData(EPISODES_FILE);
  const scheduledAnime = readData(SCHEDULED_ANIME_FILE);
  
  const exportData = {
    anime: customAnimeList,
    episodes,
    scheduled: scheduledAnime,
    exportDate: new Date().toISOString(),
    exportVersion: "1.0"
  };
  
  res.json(exportData);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Handle SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`API Documentation: http://${HOST}:${PORT}`);
  
  // Run scheduled check on startup
  checkScheduledAnime();
  
  // Simple interval instead of cron job - check once every day (86400000 ms)
  setInterval(checkScheduledAnime, 86400000);
});

// Handle errors gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
