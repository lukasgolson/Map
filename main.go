package main

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	config         Config
	store          Store
	storeMutex     sync.RWMutex
	currentWeather string = "clear"
)

func main() {
	// 1. Load configuration
	if err := loadConfig(); err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	// 2. Load persisted store
	if err := loadStore(); err != nil {
		fmt.Printf("Error loading data store: %v\n", err)
		// Initialize empty store if loading fails or file doesn't exist
		store = Store{
			History:   make([]Coordinate, 0),
			HighScore: 0,
		}
	}

	// 3. Start background pollers
	go startGarminPoller()
	go startWeatherPoller()

	// 4. Start HTTP Server
	http.HandleFunc("/api/v1/dashboard", handleDashboardAPI)

	// Serve static files from public directory
	publicDir := filepath.Join(".", "public")
	http.Handle("/", http.FileServer(http.Dir(publicDir)))

	fmt.Printf("Starting Project Lukas-Alexander-Transit server on port %s...\n", config.ServerPort)
	if err := http.ListenAndServe(":"+config.ServerPort, nil); err != nil {
		fmt.Printf("Server failed: %v\n", err)
	}
}

// loadConfig reads config.json
func loadConfig() error {
	file, err := os.Open("config.json")
	if err != nil {
		return err
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	return decoder.Decode(&config)
}

// loadStore reads the data.json flat-file storage
func loadStore() error {
	file, err := os.Open(config.DataFilePath)
	if err != nil {
		return err
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	storeMutex.Lock()
	defer storeMutex.Unlock()
	return decoder.Decode(&store)
}

// saveStore writes data to data.json
func saveStore() error {
	storeMutex.RLock()
	data, err := json.MarshalIndent(store, "", "  ")
	storeMutex.RUnlock()
	if err != nil {
		return err
	}
	return os.WriteFile(config.DataFilePath, data, 0644)
}

// handleDashboardAPI serves /api/v1/dashboard
func handleDashboardAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	storeMutex.RLock()
	state := calculateState(store.LastMove, store.LastPoint.Timestamp, store.LastPoint.Velocity)
	statusText := getStatusText(state, store.LastPoint.Velocity)

	// Calculate current score (total distance in meters)
	score := int(calculateTotalDistance(store.History) * 1000)
	if score > store.HighScore {
		storeMutex.RUnlock()
		storeMutex.Lock()
		store.HighScore = score
		storeMutex.Unlock()
		_ = saveStore()
		storeMutex.RLock()
	}

	battery := store.LastPoint.Battery
	if battery <= 0 {
		battery = 85 // Mock fallback battery percentage
	}

	payload := DashboardPayload{
		CurrentState:  state,
		History:       store.History,
		Weather:       currentWeather,
		BatteryLevel:  battery,
		HighScore:     store.HighScore,
		StatusText:    statusText,
		GoalLatitude:  config.GoalLatitude,
		GoalLongitude: config.GoalLongitude,
		GoalTitle:     config.GoalTitle,
	}
	storeMutex.RUnlock()

	json.NewEncoder(w).Encode(payload)
}

// calculateState decides if paddling, camping, resting, or disconnected
func calculateState(lastMove time.Time, lastUpdate time.Time, velocity float64) string {
	// If last parsed point is older than 24 hours, device is offline/disconnected
	if lastUpdate.IsZero() || time.Since(lastUpdate) > 24*time.Hour {
		return "disconnected"
	}
	if velocity > 20.0 {
		return "driving"
	}
	if lastMove.IsZero() {
		return "resting"
	}
	duration := time.Since(lastMove)
	if duration <= 4*time.Hour {
		return "paddling"
	} else if duration <= 72*time.Hour {
		return "camping"
	}
	return "resting"
}

// getStatusText returns humorous status based on state and speed
func getStatusText(state string, velocity float64) string {
	switch state {
	case "driving":
		return "Driving down the highway! Lukas and Alexander are on the move."
	case "paddling":
		if velocity > 5.0 {
			return "Cruising at warp speed! Lukas and Alexander's arms flailing!"
		} else if velocity > 2.0 {
			return "Paddling upstream. Steady pace."
		} else {
			return "Drifting slowly. Watching pixel clouds."
		}
	case "camping":
		return "Chilling by the campfire. Roasting marshmallows."
	case "resting":
		return "Sleeping soundly under the stars. Lukas and Alexander are dreaming of meteor-free skies."
	case "disconnected":
		return "Out of range. Lukas and Alexander are offline. Searching for satellite signals..."
	default:
		return "Exploring the digital terrarium."
	}
}

// distanceKM computes the Haversine distance
func distanceKM(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371.0 // Earth radius in km
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

// calculateTotalDistance sums up historical coordinates distance
func calculateTotalDistance(history []Coordinate) float64 {
	if len(history) < 2 {
		return 0
	}
	total := 0.0
	for i := 0; i < len(history)-1; i++ {
		total += distanceKM(history[i].Lat, history[i].Lng, history[i+1].Lat, history[i+1].Lng)
	}
	return total
}

// KML Go structures for parsing
type Kml struct {
	XMLName  xml.Name  `xml:"kml"`
	Document *Document `xml:"Document"`
}
type Document struct {
	Folder *Folder `xml:"Folder"`
}
type Folder struct {
	Placemarks []Placemark `xml:"Placemark"`
}
type Placemark struct {
	Name         string        `xml:"name"`
	TimeStamp    *TimeStamp    `xml:"TimeStamp"`
	Point        *Point        `xml:"Point"`
	ExtendedData *ExtendedData `xml:"ExtendedData"`
}
type TimeStamp struct {
	When string `xml:"when"`
}
type Point struct {
	Coordinates string `xml:"coordinates"`
}
type ExtendedData struct {
	Data []DataField `xml:"Data"`
}
type DataField struct {
	Name  string `xml:"name,attr"`
	Value string `xml:"value"`
}

// startGarminPoller polls the Garmin feed periodically
func startGarminPoller() {
	// Poll immediately on startup
	pollGarmin()

	ticker := time.NewTicker(time.Duration(config.GarminPollIntervalMinutes) * time.Minute)
	for range ticker.C {
		pollGarmin()
	}
}

func pollGarmin() {
	fmt.Printf("[%s] Polling Garmin KML feed...\n", time.Now().Format(time.RFC3339))
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", config.GarminFeedURL, nil)
	if err != nil {
		fmt.Printf("Error creating Garmin request: %v\n", err)
		return
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.SetBasicAuth("", config.GarminPassword)
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Error requesting Garmin feed: %v\n", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		fmt.Printf("Garmin feed HTTP error: %d %s\n", resp.StatusCode, resp.Status)
		return
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Error reading Garmin feed response: %v\n", err)
		return
	}

	var kml Kml
	if err := xml.Unmarshal(bodyBytes, &kml); err != nil {
		fmt.Printf("Error parsing Garmin KML: %v\n", err)
		return
	}

	if kml.Document == nil || kml.Document.Folder == nil {
		fmt.Println("No folder or document found in Garmin KML.")
		return
	}

	var points []GarminPoint

	for _, pm := range kml.Document.Folder.Placemarks {
		if pm.Point == nil {
			continue
		}
		// Parse Coordinates: e.g. "-123.125818,49.236816,79.58"
		coordsStr := strings.TrimSpace(pm.Point.Coordinates)
		parts := strings.Split(coordsStr, ",")
		if len(parts) < 2 {
			continue
		}
		lng, err1 := strconv.ParseFloat(parts[0], 64)
		lat, err2 := strconv.ParseFloat(parts[1], 64)
		if err1 != nil || err2 != nil {
			continue
		}

		// Parse Timestamp
		var t time.Time
		if pm.TimeStamp != nil && pm.TimeStamp.When != "" {
			t, err = time.Parse(time.RFC3339, pm.TimeStamp.When)
			if err != nil {
				// Try alternative UTC layout
				t, err = time.Parse("2006-01-02T15:04:05Z", pm.TimeStamp.When)
			}
		}
		if t.IsZero() {
			t = time.Now()
		}

		// Parse ExtendedData
		var velocity float64 = 0.0
		var battery int = 0
		if pm.ExtendedData != nil {
			for _, df := range pm.ExtendedData.Data {
				if df.Name == "Velocity" {
					// "2.0 km/h" -> extract 2.0
					fmt.Sscanf(df.Value, "%f", &velocity)
				} else if df.Name == "Battery" {
					fmt.Sscanf(df.Value, "%d", &battery)
				}
			}
		}

		points = append(points, GarminPoint{
			Coordinate: Coordinate{
				Lng:       lng,
				Lat:       lat,
				Timestamp: t,
				Velocity:  velocity,
			},
			Battery: battery,
		})
	}

	if len(points) == 0 {
		fmt.Println("No GPS points parsed from Garmin feed.")
		return
	}

	// Sort points chronologically (if multiple)
	// Using basic bubble sort or similar, or just loop through (usually KML has them sorted, let's process them in KML order which is chronologically or reverse. Let's check: typically Garmin feeds have them in chronological order. We can ensure we append points that are newer than our last known point).
	storeMutex.Lock()
	defer storeMutex.Unlock()

	updated := false
	for _, p := range points {
		// Check if point is already in store history to prevent duplicates
		isDuplicate := false
		for _, hist := range store.History {
			// Compare coordinates. Since floating point math can have precision issues, let's compare within 0.00001
			if math.Abs(hist.Lat-p.Lat) < 0.00001 && math.Abs(hist.Lng-p.Lng) < 0.00001 {
				isDuplicate = true
				break
			}
		}

		if !isDuplicate {
			// Append to history
			store.History = append(store.History, p.Coordinate)
			updated = true
		}

		// Update last point if it is newer
		if store.LastPoint.Timestamp.IsZero() || p.Timestamp.After(store.LastPoint.Timestamp) {
			// Check if movement happened relative to previous LastPoint
			if !store.LastPoint.Timestamp.IsZero() {
				dist := distanceKM(p.Lat, p.Lng, store.LastPoint.Lat, store.LastPoint.Lng)
				if dist > 0.1 {
					store.LastMove = p.Timestamp
					fmt.Printf("Movement of %.2f km detected! Updating LastMove to %s\n", dist, p.Timestamp.Format(time.RFC3339))
				}
			} else {
				// Seed LastMove
				store.LastMove = p.Timestamp
			}
			store.LastPoint = p
		}
	}

	if updated {
		fmt.Printf("Data store updated with new points. Total coordinates: %d\n", len(store.History))
		// Release lock to save store, but wait, we have the mutex locked. Let's do it safely.
		// Save store will require lock, but we can do a direct write since we have the lock here.
		data, err := json.MarshalIndent(store, "", "  ")
		if err == nil {
			_ = os.WriteFile(config.DataFilePath, data, 0644)
		}
	} else {
		fmt.Println("No new points found in this poll.")
	}
}

// startWeatherPoller updates weather from Open-Meteo
func startWeatherPoller() {
	updateWeather()

	// Poll weather every 30 minutes
	ticker := time.NewTicker(30 * time.Minute)
	for range ticker.C {
		updateWeather()
	}
}

func updateWeather() {
	storeMutex.RLock()
	if len(store.History) == 0 {
		storeMutex.RUnlock()
		return
	}
	latestCoord := store.History[len(store.History)-1]
	storeMutex.RUnlock()

	url := fmt.Sprintf("%s?latitude=%f&longitude=%f&current_weather=true", config.OpenMeteoURL, latestCoord.Lat, latestCoord.Lng)
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		fmt.Printf("Error creating weather request: %v\n", err)
		return
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Error requesting Open-Meteo weather: %v\n", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	var data struct {
		CurrentWeather struct {
			WeatherCode int `json:"weathercode"`
		} `json:"current_weather"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return
	}

	// Map weather code to descriptive string
	code := data.CurrentWeather.WeatherCode
	var weatherDesc string
	switch {
	case code == 0 || code == 1:
		weatherDesc = "clear"
	case code == 2 || code == 3:
		weatherDesc = "cloudy"
	case code == 45 || code == 48:
		weatherDesc = "foggy"
	case (code >= 51 && code <= 57) || (code >= 80 && code <= 82) || code == 61 || code == 63 || code == 65 || code == 66 || code == 67:
		weatherDesc = "rainy"
	case (code >= 71 && code <= 77) || code == 85 || code == 86:
		weatherDesc = "snowy"
	case code >= 95 && code <= 99:
		weatherDesc = "stormy"
	default:
		weatherDesc = "clear"
	}

	storeMutex.Lock()
	currentWeather = weatherDesc
	storeMutex.Unlock()
	fmt.Printf("Updated weather state to: %s (code %d)\n", weatherDesc, code)
}
