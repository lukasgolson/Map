package main

import (
	"database/sql"
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

	_ "modernc.org/sqlite"
)

var (
	config           Config
	store            Store
	storeMutex       sync.RWMutex
	currentWeather   string = "clear"
	pollIntervalChan        = make(chan time.Duration, 10)
	db               *sql.DB
	departureTime    time.Time
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
	InitTestRoute()
	go startGarminPoller()
	go startWeatherPoller()

	// 4. Start HTTP Server
	http.HandleFunc("/api/v1/dashboard", handleDashboardAPI)
	http.HandleFunc("/api/v1/settings", handleSettings)
	http.HandleFunc("/api/v1/test-kml", handleTestKML)
	http.HandleFunc("/api/v1/test/reset", handleTestReset)

	// Serve static files from public directory
	publicDir := filepath.Join(".", "public")
	http.Handle("/", http.FileServer(http.Dir(publicDir)))

	fmt.Printf("Starting Olson's Adventure Map server on port %s...\n", config.ServerPort)
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
	if err := decoder.Decode(&config); err != nil {
		return err
	}
	
	if config.DepartureTimeStr != "" {
		departureTime, err = time.Parse(time.RFC3339, config.DepartureTimeStr)
		if err != nil {
			fmt.Printf("Warning: failed to parse departure time '%s': %v\n", config.DepartureTimeStr, err)
		} else {
			fmt.Printf("Departure time set to: %s\n", departureTime.Format(time.RFC3339))
		}
	}
	return nil
}

// initDB initializes the SQLite database and migrates data if necessary
func initDB() error {
	dbPath := config.DataFilePath
	if strings.HasSuffix(strings.ToLower(dbPath), ".json") {
		dbPath = strings.TrimSuffix(dbPath, filepath.Ext(dbPath)) + ".db"
		config.DataFilePath = dbPath
		_ = saveConfig()
	}

	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open sqlite database: %w", err)
	}

	// Create tables
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			lng REAL,
			lat REAL,
			timestamp TEXT,
			velocity REAL,
			battery INTEGER,
			weather TEXT,
			heading REAL
		);
		CREATE TABLE IF NOT EXISTS metadata (
			key TEXT PRIMARY KEY,
			value TEXT
		);
	`)
	if err != nil {
		return fmt.Errorf("failed to create database tables: %w", err)
	}

	// Try to add heading column to handle upgrades safely
	_, _ = db.Exec("ALTER TABLE history ADD COLUMN heading REAL")

	// Migrate from data.json if it exists
	if err := migrateFromJSON(); err != nil {
		fmt.Printf("Warning: legacy data.json migration failed: %v\n", err)
	}

	return nil
}

// migrateFromJSON imports history and metadata from data.json to SQLite
func migrateFromJSON() error {
	jsonPath := "data.json"
	if _, err := os.Stat(jsonPath); os.IsNotExist(err) {
		return nil
	}

	fmt.Println("Migrating legacy data.json flat file to SQLite...")

	file, err := os.Open(jsonPath)
	if err != nil {
		return err
	}

	var legacyStore Store
	if err := json.NewDecoder(file).Decode(&legacyStore); err != nil {
		file.Close()
		return fmt.Errorf("failed to parse data.json: %w", err)
	}
	file.Close()

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Insert history points
	stmt, err := tx.Prepare("INSERT INTO history (lng, lat, timestamp, velocity, battery, weather, heading) VALUES (?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, pt := range legacyStore.History {
		_, err = stmt.Exec(pt.Lng, pt.Lat, pt.Timestamp.Format(time.RFC3339), pt.Velocity, pt.Battery, pt.Weather, pt.Heading)
		if err != nil {
			return err
		}
	}

	// Insert metadata
	metaStmt, err := tx.Prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
	if err != nil {
		return err
	}
	defer metaStmt.Close()

	_, err = metaStmt.Exec("high_score", strconv.Itoa(legacyStore.HighScore))
	if err != nil {
		return err
	}

	if !legacyStore.LastMove.IsZero() {
		_, err = metaStmt.Exec("last_move", legacyStore.LastMove.Format(time.RFC3339))
		if err != nil {
			return err
		}
	}

	if !legacyStore.LastPoint.Timestamp.IsZero() {
		lastPointBytes, err := json.Marshal(legacyStore.LastPoint)
		if err == nil {
			_, err = metaStmt.Exec("last_point", string(lastPointBytes))
			if err != nil {
				return err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Rename file to prevent re-migration
	backupPath := "data.json.bak"
	if err := os.Rename(jsonPath, backupPath); err != nil {
		fmt.Printf("Warning: failed to rename data.json: %v\n", err)
	} else {
		fmt.Println("Migration complete! Legacy data.json renamed to data.json.bak")
	}

	return nil
}

// loadStore initializes the SQLite database and reads the persisted state
func loadStore() error {
	if err := initDB(); err != nil {
		return err
	}

	storeMutex.Lock()
	defer storeMutex.Unlock()

	// Query history coordinates
	rows, err := db.Query("SELECT lng, lat, timestamp, velocity, battery, weather, heading FROM history ORDER BY id ASC")
	if err != nil {
		return err
	}
	defer rows.Close()

	store.History = make([]Coordinate, 0)
	for rows.Next() {
		var pt Coordinate
		var tsStr string
		var heading sql.NullFloat64
		err := rows.Scan(&pt.Lng, &pt.Lat, &tsStr, &pt.Velocity, &pt.Battery, &pt.Weather, &heading)
		if err != nil {
			return err
		}
		pt.Timestamp, _ = time.Parse(time.RFC3339, tsStr)
		if heading.Valid {
			pt.Heading = heading.Float64
		}
		store.History = append(store.History, pt)
	}

	// Query metadata
	rowsMeta, err := db.Query("SELECT key, value FROM metadata")
	if err != nil {
		return err
	}
	defer rowsMeta.Close()

	for rowsMeta.Next() {
		var key, val string
		if err := rowsMeta.Scan(&key, &val); err != nil {
			return err
		}
		switch key {
		case "high_score":
			store.HighScore, _ = strconv.Atoi(val)
		case "last_move":
			store.LastMove, _ = time.Parse(time.RFC3339, val)
		case "last_point":
			_ = json.Unmarshal([]byte(val), &store.LastPoint)
		}
	}

	return nil
}

// saveStore locks and writes all data to SQLite
func saveStore() error {
	storeMutex.RLock()
	defer storeMutex.RUnlock()
	return saveStoreLocked()
}

// handleDashboardAPI serves /api/v1/dashboard
func handleDashboardAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	storeMutex.RLock()
	
	// Filter track history: exclude points before the official departure time
	filteredHistory := make([]Coordinate, 0)
	for _, pt := range store.History {
		if pt.Timestamp.After(departureTime) || pt.Timestamp.Equal(departureTime) {
			filteredHistory = append(filteredHistory, pt)
		}
	}

	var state string
	var statusText string
	var battery int
	
	if len(filteredHistory) > 0 {
		lastPoint := filteredHistory[len(filteredHistory)-1]
		state = calculateState(store.LastMove, lastPoint.Timestamp)
		statusText = getStatusText(state, lastPoint.Velocity)
		battery = lastPoint.Battery
		if battery <= 0 {
			battery = 85
		}
	} else {
		state = "disconnected"
		statusText = "Packing his bags, and checking it twice"
		battery = 100
	}

	// Calculate current score using only filtered expedition points (in meters)
	score := int(calculateTotalDistance(filteredHistory) * 1000)
	if score > store.HighScore {
		storeMutex.RUnlock()
		storeMutex.Lock()
		store.HighScore = score
		storeMutex.Unlock()
		_ = saveStore()
		storeMutex.RLock()
	}

	payload := DashboardPayload{
		CurrentState:       state,
		History:            filteredHistory,
		Weather:            currentWeather,
		BatteryLevel:       battery,
		HighScore:          store.HighScore,
		StatusText:         statusText,
		GoalLatitude:       config.GoalLatitude,
		GoalLongitude:      config.GoalLongitude,
		GoalTitle:          config.GoalTitle,
		EnableDevPanel:     config.EnableDevPanel,
		ExtrapolatedTarget: calculateExtrapolatedTarget(state, filteredHistory, config.PollIntervalSeconds),
		DepartureTime:      config.DepartureTimeStr,
	}
	storeMutex.RUnlock()

	json.NewEncoder(w).Encode(payload)
}

// calculateExtrapolatedTarget predicts the position one step ahead when paddling
func calculateExtrapolatedTarget(state string, history []Coordinate, pollIntervalSeconds int) *Coordinate {
	if state != "paddling" || len(history) < 2 {
		return nil
	}

	lastPoint := history[len(history)-1]
	prevPoint := history[len(history)-2]

	speedKmh := lastPoint.Velocity
	if speedKmh <= 0 {
		distKm := distanceKM(prevPoint.Lat, prevPoint.Lng, lastPoint.Lat, lastPoint.Lng)
		timeHours := lastPoint.Timestamp.Sub(prevPoint.Timestamp).Hours()
		if timeHours > 0 {
			speedKmh = distKm / timeHours
		}
	}
	if speedKmh <= 0 {
		speedKmh = 5.0
	}

	headingDeg := lastPoint.Heading
	if headingDeg == 0.0 {
		headingDeg = calculateBearing(prevPoint.Lat, prevPoint.Lng, lastPoint.Lat, lastPoint.Lng)
	}

	avgHeadingRad := headingDeg * math.Pi / 180.0

	timeStep := lastPoint.Timestamp.Sub(prevPoint.Timestamp)
	if timeStep <= 0 {
		timeStep = time.Duration(pollIntervalSeconds) * time.Second
	}

	speedKmPerMs := speedKmh / 3600000.0
	timeStepMs := float64(timeStep.Milliseconds())

	latSpeedGPS := (speedKmPerMs * math.Cos(avgHeadingRad)) / 111.32
	lngSpeedGPS := (speedKmPerMs * math.Sin(avgHeadingRad)) / (111.32 * math.Cos(lastPoint.Lat*math.Pi/180.0))

	extLat := lastPoint.Lat + latSpeedGPS*timeStepMs
	extLng := lastPoint.Lng + lngSpeedGPS*timeStepMs

	return &Coordinate{
		Lat:       extLat,
		Lng:       extLng,
		Timestamp: lastPoint.Timestamp.Add(timeStep),
		Velocity:  speedKmh,
		Battery:   lastPoint.Battery,
		Weather:   lastPoint.Weather,
		Heading:   headingDeg,
	}
}

// calculateState decides if paddling, camping, resting, or disconnected
func calculateState(lastMove time.Time, lastUpdate time.Time) string {
	// If last parsed point is older than 24 hours, device is offline/disconnected
	if lastUpdate.IsZero() || time.Since(lastUpdate) > 24*time.Hour {
		return "disconnected"
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
	case "paddling":
		if velocity > 5.0 {
			return "Cruising at warp speed! Dino arms flailing!"
		} else if velocity > 2.0 {
			return "Paddling upstream. Steady dino pace."
		} else {
			return "Drifting slowly. Watching pixel clouds."
		}
	case "camping":
		return "Chilling by the campfire. Roasting marshmallows on tiny arms."
	case "resting":
		return "Sleeping soundly under the stars. Dino is dreaming of meteor-free skies."
	case "disconnected":
		return "Out of range. Dino is offline. Searching for satellite signals..."
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

// calculateBearing computes the bearing from point 1 to point 2 in degrees (0-360)
func calculateBearing(lat1, lon1, lat2, lon2 float64) float64 {
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	dLonRad := (lon2 - lon1) * math.Pi / 180

	y := math.Sin(dLonRad) * math.Cos(lat2Rad)
	x := math.Cos(lat1Rad)*math.Sin(lat2Rad) -
		math.Sin(lat1Rad)*math.Cos(lat2Rad)*math.Cos(dLonRad)

	brng := math.Atan2(y, x) * 180 / math.Pi
	return math.Mod(brng+360, 360)
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
	// Delay the initial poll slightly to let the HTTP server start up and bind
	go func() {
		time.Sleep(1 * time.Second)
		pollGarmin()
	}()

	var interval time.Duration
	if config.PollIntervalSeconds > 0 {
		interval = time.Duration(config.PollIntervalSeconds) * time.Second
	} else {
		interval = time.Duration(config.GarminPollIntervalMinutes) * time.Minute
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			pollGarmin()
		case newInterval := <-pollIntervalChan:
			ticker.Reset(newInterval)
			fmt.Printf("Garmin poller interval updated to %v\n", newInterval)
		}
	}
}

func pollGarmin() {
	fmt.Printf("[%s] Polling Garmin KML feed...\n", time.Now().Format(time.RFC3339))
	client := &http.Client{Timeout: 30 * time.Second}
	
	var url string
	if config.UseTestServer {
		url = fmt.Sprintf("http://localhost:%s/api/v1/test-kml", config.ServerPort)
	} else {
		url = config.GarminFeedURL
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		fmt.Printf("Error creating Garmin request: %v\n", err)
		return
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	if !config.UseTestServer {
		req.SetBasicAuth("", config.GarminPassword)
	}
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
				Battery:   battery,
				Weather:   "",
			},
		})
	}

	if len(points) == 0 {
		fmt.Println("No GPS points parsed from Garmin feed.")
		return
	}

	// 1. Filter out duplicates using read-lock (prevents holding write-lock during network call)
	var newPoints []GarminPoint
	storeMutex.RLock()
	for _, p := range points {
		isDuplicate := false
		for _, hist := range store.History {
			if math.Abs(hist.Lat-p.Lat) < 0.00001 && math.Abs(hist.Lng-p.Lng) < 0.00001 {
				isDuplicate = true
				break
			}
		}
		if !isDuplicate {
			newPoints = append(newPoints, p)
		}
	}
	storeMutex.RUnlock()

	if len(newPoints) == 0 {
		fmt.Println("No new points found in this poll.")
		return
	}

	// 2. Fetch weather for new points (no locks held!)
	for i := range newPoints {
		newPoints[i].Weather = getWeatherForCoord(newPoints[i].Lat, newPoints[i].Lng)
	}

	// 3. Acquire write-lock to update the store and write database
	storeMutex.Lock()
	defer storeMutex.Unlock()

	updated := false
	for _, p := range newPoints {
		// Double-check duplicate under write-lock
		isDuplicate := false
		for _, hist := range store.History {
			if math.Abs(hist.Lat-p.Lat) < 0.00001 && math.Abs(hist.Lng-p.Lng) < 0.00001 {
				isDuplicate = true
				break
			}
		}

		if !isDuplicate {
			var heading float64 = 0.0
			if len(store.History) > 0 {
				prevPt := store.History[len(store.History)-1]
				heading = calculateBearing(prevPt.Lat, prevPt.Lng, p.Lat, p.Lng)
			}
			p.Coordinate.Heading = heading
			store.History = append(store.History, p.Coordinate)
			updated = true
		}

		// Update last point if it is newer
		if store.LastPoint.Timestamp.IsZero() || p.Timestamp.After(store.LastPoint.Timestamp) {
			if !store.LastPoint.Timestamp.IsZero() {
				dist := distanceKM(p.Lat, p.Lng, store.LastPoint.Lat, store.LastPoint.Lng)
				if dist > 0.1 {
					store.LastMove = p.Timestamp
					fmt.Printf("Movement of %.2f km detected! Updating LastMove to %s\n", dist, p.Timestamp.Format(time.RFC3339))
				}
			} else {
				store.LastMove = p.Timestamp
			}
			store.LastPoint = p
		}
	}

	if updated {
		fmt.Printf("Data store updated with new points. Total coordinates: %d\n", len(store.History))
		_ = saveStoreLocked()
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
	if config.UseTestServer {
		return
	}
	storeMutex.RLock()
	if len(store.History) == 0 {
		storeMutex.RUnlock()
		return
	}
	latestCoord := store.History[len(store.History)-1]
	storeMutex.RUnlock()

	weather, err := fetchWeather(latestCoord.Lat, latestCoord.Lng)
	if err != nil {
		fmt.Printf("Error requesting Open-Meteo weather: %v\n", err)
		return
	}

	storeMutex.Lock()
	currentWeather = weather
	storeMutex.Unlock()
	fmt.Printf("Updated weather state to: %s\n", weather)
}

func mapWeatherCode(code int) string {
	switch {
	case code == 0 || code == 1:
		return "clear"
	case code == 2 || code == 3:
		return "cloudy"
	case code == 45 || code == 48:
		return "foggy"
	case (code >= 51 && code <= 57) || (code >= 80 && code <= 82) || code == 61 || code == 63 || code == 65 || code == 66 || code == 67:
		return "rainy"
	case (code >= 71 && code <= 77) || code == 85 || code == 86:
		return "snowy"
	case code >= 95 && code <= 99:
		return "stormy"
	default:
		return "clear"
	}
}

func fetchWeather(lat, lng float64) (string, error) {
	url := fmt.Sprintf("%s?latitude=%f&longitude=%f&current_weather=true", config.OpenMeteoURL, lat, lng)
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("weather API status %d", resp.StatusCode)
	}

	var data struct {
		CurrentWeather struct {
			WeatherCode int `json:"weathercode"`
		} `json:"current_weather"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}

	return mapWeatherCode(data.CurrentWeather.WeatherCode), nil
}

func getWeatherForCoord(lat, lng float64) string {
	if config.UseTestServer {
		storeMutex.RLock()
		defer storeMutex.RUnlock()
		return currentWeather
	}
	weather, err := fetchWeather(lat, lng)
	if err != nil {
		fmt.Printf("Error fetching weather for (%.4f, %.4f): %v. Using fallback.\n", lat, lng, err)
		storeMutex.RLock()
		defer storeMutex.RUnlock()
		return currentWeather
	}
	return weather
}

func handleTestKML(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/xml")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	kmlData := GenerateKML()
	w.Write([]byte(kmlData))

	// Increment the test step for the next poll
	testMutex.Lock()
	if testCurrentStep < testMaxSteps-1 {
		testCurrentStep++
		fmt.Printf("Test KML served. Advanced test step to %d/%d\n", testCurrentStep, testMaxSteps-1)
	} else {
		fmt.Println("Test KML served. Trajectory completed (at final step).")
	}
	testMutex.Unlock()
}

func saveConfig() error {
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile("config.json", data, 0644)
}

func handleSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == http.MethodGet {
		storeMutex.RLock()
		defer storeMutex.RUnlock()
		json.NewEncoder(w).Encode(config)
		return
	}

	if r.Method == http.MethodPost {
		var req struct {
			UseTestServer       bool `json:"use_test_server"`
			PollIntervalSeconds int  `json:"poll_interval_seconds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		storeMutex.Lock()
		defer storeMutex.Unlock()

		oldUseTestServer := config.UseTestServer
		config.UseTestServer = req.UseTestServer
		config.PollIntervalSeconds = req.PollIntervalSeconds

		// Handle Backup / Restore
		if config.UseTestServer && !oldUseTestServer {
			backupPath := strings.TrimSuffix(config.DataFilePath, filepath.Ext(config.DataFilePath)) + "_backup" + filepath.Ext(config.DataFilePath)
			if _, err := os.Stat(backupPath); os.IsNotExist(err) {
				fmt.Printf("Backing up live database to %s...\n", backupPath)
				err := copyFile(config.DataFilePath, backupPath)
				if err != nil {
					fmt.Printf("Warning: failed to backup database: %v\n", err)
				}
			}
			store.History = make([]Coordinate, 0)
			store.LastMove = time.Time{}
			store.LastPoint = GarminPoint{}
			_ = saveStoreLocked()
			InitTestRoute()
		} else if !config.UseTestServer && oldUseTestServer {
			backupPath := strings.TrimSuffix(config.DataFilePath, filepath.Ext(config.DataFilePath)) + "_backup" + filepath.Ext(config.DataFilePath)
			if _, err := os.Stat(backupPath); err == nil {
				fmt.Printf("Restoring live database from %s...\n", backupPath)
				err := copyFile(backupPath, config.DataFilePath)
				if err != nil {
					fmt.Printf("Error restoring live database: %v\n", err)
				} else {
					_ = os.Remove(backupPath)
					_ = reloadStoreLocked()
				}
			}
		}

		_ = saveConfig()

		var newInterval time.Duration
		if config.PollIntervalSeconds > 0 {
			newInterval = time.Duration(config.PollIntervalSeconds) * time.Second
		} else {
			newInterval = time.Duration(config.GarminPollIntervalMinutes) * time.Minute
		}
		pollIntervalChan <- newInterval

		go pollGarmin()

		json.NewEncoder(w).Encode(config)
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func handleTestReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	storeMutex.Lock()
	defer storeMutex.Unlock()

	backupPath := strings.TrimSuffix(config.DataFilePath, filepath.Ext(config.DataFilePath)) + "_backup" + filepath.Ext(config.DataFilePath)
	if _, err := os.Stat(backupPath); os.IsNotExist(err) {
		fmt.Printf("Backing up live database to %s...\n", backupPath)
		err := copyFile(config.DataFilePath, backupPath)
		if err != nil {
			fmt.Printf("Warning: failed to backup database: %v\n", err)
		}
	}

	store.History = make([]Coordinate, 0)
	store.LastMove = time.Time{}
	store.LastPoint = GarminPoint{}
	_ = saveStoreLocked()

	InitTestRoute()

	go pollGarmin()

	json.NewEncoder(w).Encode(map[string]string{"status": "reset"})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	if err != nil {
		return err
	}
	return out.Sync()
}

func saveStoreLocked() error {
	if db == nil {
		return fmt.Errorf("database is not initialized")
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Clear existing history
	_, err = tx.Exec("DELETE FROM history")
	if err != nil {
		return err
	}

	// Insert history
	stmt, err := tx.Prepare("INSERT INTO history (lng, lat, timestamp, velocity, battery, weather, heading) VALUES (?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, pt := range store.History {
		_, err = stmt.Exec(pt.Lng, pt.Lat, pt.Timestamp.Format(time.RFC3339), pt.Velocity, pt.Battery, pt.Weather, pt.Heading)
		if err != nil {
			return err
		}
	}

	// Save metadata
	metaStmt, err := tx.Prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
	if err != nil {
		return err
	}
	defer metaStmt.Close()

	_, err = metaStmt.Exec("high_score", strconv.Itoa(store.HighScore))
	if err != nil {
		return err
	}

	if !store.LastMove.IsZero() {
		_, err = metaStmt.Exec("last_move", store.LastMove.Format(time.RFC3339))
		if err != nil {
			return err
		}
	} else {
		_, err = tx.Exec("DELETE FROM metadata WHERE key = 'last_move'")
		if err != nil {
			return err
		}
	}

	if !store.LastPoint.Timestamp.IsZero() {
		lastPointBytes, err := json.Marshal(store.LastPoint)
		if err == nil {
			_, err = metaStmt.Exec("last_point", string(lastPointBytes))
			if err != nil {
				return err
			}
		}
	} else {
		_, err = tx.Exec("DELETE FROM metadata WHERE key = 'last_point'")
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func reloadStoreLocked() error {
	if db == nil {
		return fmt.Errorf("database is not initialized")
	}

	// Read history
	rows, err := db.Query("SELECT lng, lat, timestamp, velocity, battery, weather, heading FROM history ORDER BY id ASC")
	if err != nil {
		return err
	}
	defer rows.Close()

	store.History = make([]Coordinate, 0)
	for rows.Next() {
		var pt Coordinate
		var tsStr string
		var heading sql.NullFloat64
		err := rows.Scan(&pt.Lng, &pt.Lat, &tsStr, &pt.Velocity, &pt.Battery, &pt.Weather, &heading)
		if err != nil {
			return err
		}
		pt.Timestamp, _ = time.Parse(time.RFC3339, tsStr)
		if heading.Valid {
			pt.Heading = heading.Float64
		}
		store.History = append(store.History, pt)
	}

	// Read metadata
	rowsMeta, err := db.Query("SELECT key, value FROM metadata")
	if err != nil {
		return err
	}
	defer rowsMeta.Close()

	// Reset metadata first
	store.HighScore = 0
	store.LastMove = time.Time{}
	store.LastPoint = GarminPoint{}

	for rowsMeta.Next() {
		var key, val string
		if err := rowsMeta.Scan(&key, &val); err != nil {
			return err
		}
		switch key {
		case "high_score":
			store.HighScore, _ = strconv.Atoi(val)
		case "last_move":
			store.LastMove, _ = time.Parse(time.RFC3339, val)
		case "last_point":
			_ = json.Unmarshal([]byte(val), &store.LastPoint)
		}
	}

	return nil
}
