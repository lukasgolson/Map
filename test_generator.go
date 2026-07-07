package main

import (
	"fmt"
	"math"
	"math/rand"
	"strings"
	"sync"
	"time"
)

var (
	testMutex       sync.Mutex
	testStartLat    float64
	testStartLng    float64
	testEndLat      float64
	testEndLng      float64
	testCurrentStep int
	testMaxSteps    int = 30
	testPoints      []GarminPoint
)

// InitTestRoute seeds a random trajectory in Vancouver
func InitTestRoute() {
	testMutex.Lock()
	defer testMutex.Unlock()

	// Bounding box for Vancouver:
	// Lat: [49.2000, 49.3000]
	// Lng: [-123.2500, -123.0200]
	for {
		lat1 := 49.2000 + rand.Float64()*(49.3000-49.2000)
		lng1 := -123.2500 + rand.Float64()*(-123.0200 - -123.2500)
		lat2 := 49.2000 + rand.Float64()*(49.3000-49.2000)
		lng2 := -123.2500 + rand.Float64()*(-123.0200 - -123.2500)

		if distanceKM(lat1, lng1, lat2, lng2) >= 3.0 {
			testStartLat = lat1
			testStartLng = lng1
			testEndLat = lat2
			testEndLng = lng2
			break
		}
	}

	testCurrentStep = 0
	testPoints = make([]GarminPoint, testMaxSteps)

	// Fetch weather once for Vancouver route to avoid spamming weather API
	testWeather := "clear"
	if w, err := fetchWeather(testStartLat, testStartLng); err == nil {
		testWeather = w
	}

	// Generate a biased random walk ("ant crawl") from start to end
	// Seed with a timestamp in the past
	startTime := time.Now().Add(-time.Duration(testMaxSteps) * time.Minute)
	testPoints[0] = GarminPoint{
		Coordinate: Coordinate{
			Lat:       testStartLat,
			Lng:       testStartLng,
			Timestamp: startTime,
			Velocity:  0.0,
			Battery:   100,
			Weather:   testWeather,
		},
	}

	currLat := testStartLat
	currLng := testStartLng

	for i := 1; i < testMaxSteps; i++ {
		// If it's the last step, snap exactly to the end point
		if i == testMaxSteps-1 {
			testPoints[i] = GarminPoint{
				Coordinate: Coordinate{
					Lat:       testEndLat,
					Lng:       testEndLng,
					Timestamp: startTime.Add(time.Duration(i) * time.Minute),
					Velocity:  5.0,
					Battery:   100 - i,
					Weather:   testWeather,
				},
			}
			break
		}

		// Calculate vector to target
		dLat := testEndLat - currLat
		dLng := testEndLng - currLng
		dist := math.Sqrt(dLat*dLat + dLng*dLng)

		// Remaining steps
		remSteps := float64(testMaxSteps - i)

		// Base step size is total remaining distance divided by remaining steps
		stepSize := dist / remSteps

		// Add random step size variation (70% to 130% of base step size)
		stepSize = stepSize * (0.7 + rand.Float64()*0.6)

		// Angle to target
		angle := math.Atan2(dLat, dLng)

		// Standard angle jitter (very small for mostly straight trajectory-based path)
		maxJitter := math.Pi / 36.0 // +/- 5 degrees

		// 15% chance of a complete random drift / detour
		if rand.Float64() < 0.15 {
			maxJitter = math.Pi / 3.0 // +/- 60 degrees
			fmt.Printf("[SIM] Occasional random drift triggered at step %d\n", i)
		}

		jitterAngle := angle + (rand.Float64()-0.5)*2.0*maxJitter

		// Calculate new coordinates
		nextLat := currLat + stepSize*math.Sin(jitterAngle)
		nextLng := currLng + stepSize*math.Cos(jitterAngle)

		// Calculate velocity (4.5 to 6.5 km/h)
		velocity := 4.5 + rand.Float64()*2.0
		battery := 100 - i
		if battery < 0 {
			battery = 0
		}

		testPoints[i] = GarminPoint{
			Coordinate: Coordinate{
				Lat:       nextLat,
				Lng:       nextLng,
				Timestamp: startTime.Add(time.Duration(i) * time.Minute),
				Velocity:  velocity,
				Battery:   battery,
				Weather:   testWeather,
			},
		}

		currLat = nextLat
		currLng = nextLng
	}

	fmt.Printf("Generated ant-crawl test route: Start(%.4f, %.4f) -> End(%.4f, %.4f) over %d steps\n",
		testStartLat, testStartLng, testEndLat, testEndLng, testMaxSteps)
}

// GenerateKML serves KML string for points up to current test step
func GenerateKML() string {
	testMutex.Lock()
	defer testMutex.Unlock()

	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n")
	sb.WriteString(`<kml xmlns="http://www.opengis.net/kml/2.2">` + "\n")
	sb.WriteString("  <Document>\n")
	sb.WriteString("    <Folder>\n")

	// Output up to testCurrentStep
	for i := 0; i <= testCurrentStep && i < len(testPoints); i++ {
		p := testPoints[i]
		sb.WriteString("      <Placemark>\n")
		sb.WriteString(fmt.Sprintf("        <name>Test Point %d</name>\n", i))
		sb.WriteString("        <TimeStamp>\n")
		sb.WriteString(fmt.Sprintf("          <when>%s</when>\n", p.Timestamp.Format(time.RFC3339)))
		sb.WriteString("        </TimeStamp>\n")
		sb.WriteString("        <Point>\n")
		sb.WriteString(fmt.Sprintf("          <coordinates>%.6f,%.6f,0.0</coordinates>\n", p.Lng, p.Lat))
		sb.WriteString("        </Point>\n")
		sb.WriteString("        <ExtendedData>\n")
		sb.WriteString("          <Data name=\"Velocity\">\n")
		sb.WriteString(fmt.Sprintf("            <value>%.2f km/h</value>\n", p.Velocity))
		sb.WriteString("          </Data>\n")
		sb.WriteString("          <Data name=\"Battery\">\n")
		sb.WriteString(fmt.Sprintf("            <value>%d</value>\n", p.Battery))
		sb.WriteString("          </Data>\n")
		sb.WriteString("        </ExtendedData>\n")
		sb.WriteString("      </Placemark>\n")
	}

	sb.WriteString("    </Folder>\n")
	sb.WriteString("  </Document>\n")
	sb.WriteString("</kml>\n")

	return sb.String()
}
