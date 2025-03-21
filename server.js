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
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

// GraphQL query to get anime details with enhanced fields
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
  
  // Better status formatting
  const formatStatus = (status) => {
    if (!status) return "Unknown";
    switch (status) {
      case "FINISHED": return "Completed";
      case "RELEASING": return "Airing";
      case "NOT_YET_RELEASED": return "Upcoming";
      case "CANCELLED": return "Cancelled";
      case "HIATUS": return "On Hiatus";
      default: return status;
    }
  };
  
  return {
    id: media.id.toString(),
    title: media.title.english || media.title.romaji || "Unknown Title",
    titleRomaji: media.title.romaji || media.title.english || "",
    titleNative: media.title.native || "",
    description: media.description?.replace(/<br>/g, '\n').replace(/<\/?[^>]+(>|$)/g, "") || "No description available",
    genres: media.genres || [],
    tags: media.tags?.map(tag => ({
      name: tag.name,
      category: tag.category,
      rank: tag.rank
    })) || [],
    // Use extraLarge image by default for HD quality
    thumbnail: media.coverImage?.extraLarge || media.coverImage?.large || "https://via.placeholder.com/500x750?text=No+Image",
    thumbnailLarge: media.coverImage?.large || media.coverImage?.medium || "https://via.placeholder.com/500x750?text=No+Image",
    thumbnailMedium: media.coverImage?.medium || media.coverImage?.large || "https://via.placeholder.com/225x335?text=No+Image",
    imageExtraLarge: media.coverImage?.extraLarge || "https://via.placeholder.com/1000x1500?text=No+Image",
    imageBanner: media.bannerImage || null,
    imageColor: media.coverImage?.color || "#808080",
    rating: media.averageScore / 10 || 0,
    meanScore: media.meanScore || 0,
    popularity: media.popularity || 0,
    episodeCount: media.episodes?.toString() || "Unknown",
    episodeLength: media.duration?.toString() || "Unknown",
    status: formatStatus(media.status),
    format: media.format || "Unknown",
    source: media.source || "Unknown",
    startDate: formatDate(media.startDate),
    endDate: formatDate(media.endDate),
    season: media.season || "Unknown",
    seasonYear: media.seasonYear || null,
    studios: media.studios?.nodes?.map(studio => ({
      name: studio.name || "Unknown Studio",
      isAnimationStudio: studio.isAnimationStudio || false
    })) || [],
    relations: media.relations?.edges?.map(relation => ({
      type: relation.relationType || "Related",
      id: relation.node.id.toString(),
      title: relation.node.title.romaji || "Unknown Title",
      mediaType: relation.node.type || "Unknown",
      format: relation.node.format || "Unknown",
      thumbnail: relation.node.coverImage?.medium || "https://via.placeholder.com/225x335?text=No+Image"
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
      site: link.site || "External Link",
      url: link.url || "#"
    })) || [],
    dateAdded: new Date().toISOString()
  };
};

// Format search results with enhanced details and HD images
const formatSearchResults = (anilistData) => {
  if (!anilistData?.data?.Page?.media) {
    return [];
  }
  
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
    
    // Better status formatting
    const formatStatus = (status) => {
      if (!status) return "Unknown";
      switch (status) {
        case "FINISHED": return "Completed";
        case "RELEASING": return "Airing";
        case "NOT_YET_RELEASED": return "Upcoming";
        case "CANCELLED": return "Cancelled";
        case "HIATUS": return "On Hiatus";
        default: return status;
      }
    };
    
    return {
      id: media.id.toString(),
      title: media.title.english || media.title.romaji || "Unknown Title",
      titleRomaji: media.title.romaji || media.title.english || "",
      titleNative: media.title.native || "",
      description: media.description?.replace(/<br>/g, '\n').replace(/<\/?[^>]+(>|$)/g, "") || "No description available",
      genres: media.genres || [],
      // Use extraLarge image by default for HD quality
      thumbnail: media.coverImage?.extraLarge || media.coverImage?.large || "https://via.placeholder.com/500x750?text=No+Image",
      thumbnailLarge: media.coverImage?.large || media.coverImage?.medium || "https://via.placeholder.com/500x750?text=No+Image",
      thumbnailMedium: media.coverImage?.medium || media.coverImage?.large || "https://via.placeholder.com/225x335?text=No+Image",
      imageExtraLarge: media.coverImage?.extraLarge || "https://via.placeholder.com/1000x1500?text=No+Image",
      imageBanner: media.bannerImage || null,
      imageColor: media.coverImage?.color || "#808080",
      rating: media.averageScore / 10 || 0,
      popularity: media.popularity || 0,
      episodeCount: media.episodes?.toString() || "Unknown",
      episodeLength: media.duration?.toString() || "Unknown",
      status: formatStatus(media.status),
      format: media.format || "Unknown",
      startDate: formatDate(media.startDate),
      endDate: formatDate(media.endDate),
      season: media.season || "Unknown",
      seasonYear: media.seasonYear || null,
      studios: media.studios?.nodes?.map(studio => studio.name || "Unknown Studio") || [],
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
          console.error(`Error fetching details for anime ID ${animeInfo.id}:`, error.message);
          // If AniList fails, use our stored custom data or a placeholder
          animeDetail = animeInfo.hasOwnProperty('title') ? animeInfo : {
            id: animeInfo.id,
            title: "Unknown Anime",
            description: "Failed to load details",
            thumbnail: "https://via.placeholder.com/500x750?text=Failed+to+Load",
            status: "Unknown",
            dateAdded: new Date().toISOString()
          };
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
    
    // Better status formatting
    const formatStatus = (status) => {
      if (!status) return "Unknown";
      switch (status) {
        case "FINISHED": return "Completed";
        case "RELEASING": return "Airing";
        case "NOT_YET_RELEASED": return "Upcoming";
        case "CANCELLED": return "Cancelled";
        case "HIATUS": return "On Hiatus";
        default: return status;
      }
    };
    
    const results = response.data.data.Page.media.map(media => {
      return {
        id: media.id.toString(),
        title: media.title.english || media.title.romaji || "Unknown Title",
        titleRomaji: media.title.romaji || media.title.english || "",
        // Use extraLarge image by default for HD quality
        thumbnail: media.coverImage?.extraLarge || media.coverImage?.large || "https://via.placeholder.com/500x750?text=No+Image",
        thumbnailLarge: media.coverImage?.large || "https://via.placeholder.com/500x750?text=No+Image",
        thumbnailMedium: media.coverImage?.medium || "https://via.placeholder.com/225x335?text=No+Image",
        imageBanner: media.bannerImage || null,
        imageColor: media.coverImage?.color || "#808080",
        rating: media.averageScore / 10 || 0,
        popularity: media.popularity || 0,
        episodeCount: media.episodes || "?",
        status: formatStatus(media.status),
        season: `${media.season || "Unknown"} ${media.seasonYear || ""}`.trim()
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
      console.error(`Error fetching from AniList for ID ${animeId}:`, anilistError.message);
      
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
      console.error("Error fetching anime details for scheduling:", error);
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

// Add anime to library
app.post('/api/anime', async (req, res) => {
  try {
    const { anilistId } = req.body;
    
    if (!anilistId) {
      return res.status(400).json({ error: 'AniList ID is required' });
    }
    
    // Check if anime already exists in our list
    const customAnimeList = readData(CUSTOM_ANIME_FILE);
    if (customAnimeList.some(a => a.id === anilistId.toString())) {
      // If already in library, just return it
      const animeIndex = customAnimeList.findIndex(a => a.id === anilistId.toString());
      
      // Try to fetch from AniList for fresh data
      try {
        const response = await axios.post(ANILIST_API, {
          query: getAnimeQuery,
          variables: { id: parseInt(anilistId) }
        });
        
        // Format the data
        const animeDetail = formatAnimeData(response.data);
        
        // Cache the result
        animeCache.set(anilistId.toString(), animeDetail);
        
        return res.json(animeDetail);
      } catch (error) {
        console.error("Error updating anime in library:", error);
        // Return existing entry
        if (animeCache.has(anilistId.toString())) {
          return res.json(animeCache.get(anilistId.toString()));
        } else {
          return res.status(400).json({ error: 'Failed to update anime details' });
        }
      }
    }
    
    // Fetch anime details from AniList
    try {
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
        
        return res.status(201).json(animeDetail);
      } else {
        return res.status(500).json({ error: 'Failed to add anime to list' });
      }
    } catch (error) {
      console.error("Error adding anime:", error);
      
      return res.status(400).json({ error: 'Invalid AniList ID or API error' });
    }
  } catch (error) {
    console.error("Error in add anime endpoint:", error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove anime from library
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

// Enhanced search with pagination and filtering
app.get('/api/search', async (req, res) => {
  const { query = "", page = 1, perPage = 10, genre, season, year, status } = req.query;
  
  // Accept at least one parameter but make it more forgiving
  if (!query && !genre && !season && !year && !status) {
    // Return trending anime instead of error for empty search
    try {
      const response = await axios.post(ANILIST_API, {
        query: searchAnimeQuery,
        variables: { 
          page: parseInt(page),
          perPage: parseInt(perPage),
          sort: "POPULARITY_DESC"
        }
      });
      
      const searchResults = {
        pageInfo: response.data.data.Page.pageInfo,
        results: formatSearchResults(response.data)
      };
      
      return res.json(searchResults);
    } catch (error) {
      console.error("Error fetching popular anime for empty search:", error);
      return res.status(500).json({ error: 'Failed to fetch popular anime' });
    }
  }
  
  try {
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
    
    console.log("Search query parameters:", { 
      search: query || undefined,
      page: parseInt(page),
      perPage: parseInt(perPage),
      genre: genre || undefined,
      season: seasonEnum,
      seasonYear: year ? parseInt(year) : undefined,
      status: statusEnum
    });
    
    const response = await axios.post(ANILIST_API, {
      query: searchAnimeQuery,
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
      results: formatSearchResults(response.data)
    };
    
    res.json(searchResults);
  } catch (error) {
    console.error("Error searching anime:", error);
    res.status(500).json({ 
      error: 'Failed to search anime',
      pageInfo: { currentPage: 1, lastPage: 1, hasNextPage: false, perPage: parseInt(perPage) },
      results: []
    });
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
