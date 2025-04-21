require("dotenv").config();

const express = require("express");
const app = express();
const cors = require("./cors");
const ee = require("@google/earthengine");

const privateKey = {
  type: "service_account",
  project_id: "checkyourfield",
  private_key_id: "6ccd8837cef9af9ed0ffe74360a90f090dc92856",
  private_key: process.env.EE_PRIVATE_KEY,
  client_email: "checkyourfield@checkyourfield.iam.gserviceaccount.com",
  client_id: "100252327762775213603",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url:
    "https://www.googleapis.com/robot/v1/metadata/x509/checkyourfield%40checkyourfield.iam.gserviceaccount.com",
};

const port = process.env.PORT || 3000;

app.use(cors());

// === EARTH ENGINE SETUP ===
const initialize = () => {
  ee.initialize(
    null,
    null,
    () => console.info("Earth Engine initialized successfully."),
    (err) => console.error("EE initialization error:", err)
  );
};

ee.data.authenticateViaPrivateKey(privateKey, initialize, (err) => {
  console.error("EE authentication error:", err);
});

// === HELPERS ===
const safeParseJSON = (str) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error("JSON parsing error:", e);
    return null;
  }
};

// === ROUTES ===

app.get("/", (req, res) => {
  res.send("Server is alive");
});

app.get("/calculatearea/:coordinates", async (req, res) => {
  const rawCoords = req.params.coordinates;
  console.debug("[/calculatearea] Raw coordinates:", rawCoords);

  const parsedCoords = safeParseJSON(rawCoords);
  if (!parsedCoords) {
    return res.status(400).json({ error: "Invalid JSON in coordinates" });
  }

  try {
    const geometry = ee.Geometry.Polygon(parsedCoords);

    const getArea = () =>
      new Promise((resolve, reject) => {
        geometry
          .area()
          .divide(1000 * 10)
          .evaluate((result, error) => {
            if (error) return reject(error);
            resolve(result);
          });
      });

    const area = await getArea();
    console.debug("[/calculatearea] Area result (ha):", area);
    res.json({ area: area.toFixed(2) });
  } catch (err) {
    console.error("[/calculatearea] Error:", err);
    res.status(500).json({ error: "Failed to calculate area" });
  }
});

app.get("/getdates/:coordinates", async (req, res) => {
  const rawCoords = req.params.coordinates;
  console.debug("[/getdates] Raw coordinates:", rawCoords);

  const parsedCoords = safeParseJSON(rawCoords);
  if (!parsedCoords) {
    return res.status(400).json({ error: "Invalid JSON in coordinates" });
  }

  try {
    const geometry = ee.Geometry.Polygon(parsedCoords);

    const imageCollection = ee
      .ImageCollection("COPERNICUS/S2")
      .filterDate("2015-01-01", "2099-05-01")
      .filterBounds(geometry)
      .filterMetadata("CLOUDY_PIXEL_PERCENTAGE", "less_than", 15)
      .map((img) => {
        const ndvi = img.normalizedDifference(["B8", "B4"]).rename("nd");

        // Check if QA60 exists; if not, skip masking
        const bandNames = img.bandNames();
        const hasQA60 = bandNames.contains("QA60");

        const maskedImg = ee.Algorithms.If(
          hasQA60,
          (() => {
            const QA = img.select("QA60");
            const clouds = QA.bitwiseAnd(1 << 10).eq(0);
            const cirrus = QA.bitwiseAnd(1 << 11).eq(0);
            return img.updateMask(clouds).updateMask(cirrus);
          })(),
          img
        );

        const imgWithNDVI = ee.Image(maskedImg).addBands(ndvi);

        return imgWithNDVI
          .set("system:time_start", img.get("system:time_start"))
          .set("nd_mean", ndvi.reduceRegion(ee.Reducer.mean(), geometry, 10).get("nd"));
      });

    const sorted = imageCollection.sort("system:time_start");
    const list = sorted.toList(sorted.size());

    const maxDifference = ee.Number(0.2);

    const differences = ee.List.sequence(0, list.size().subtract(2)).map((i) => {
      const i0 = ee.Number(i);
      const i1 = i0.add(1);

      const imgA = ee.Image(list.get(i0));
      const imgB = ee.Image(list.get(i1));

      const ndA = ee.Number(imgA.get("nd_mean"));
      const ndB = ee.Number(imgB.get("nd_mean"));
      const diff = ndB.subtract(ndA);

      return ee.Algorithms.If(
        diff.gt(maxDifference),
        {
          dateFrom: ee.Date(imgA.get("system:time_start")).format("YYYY-MM-dd"),
          dateTo: ee.Date(imgB.get("system:time_start")).format("YYYY-MM-dd"),
          difference: diff,
        },
        null
      );
    });

    const filtered = ee.List(differences).removeAll([null]);

    filtered.evaluate((result, error) => {
      if (error) {
        console.error("[/getdates] Evaluation error:", error);
        return res.status(500).json({ error: "Earth Engine evaluation failed" });
      }

      console.debug("[/getdates] Returning", result.length, "items");
      res.json(result.reverse());
    });
  } catch (err) {
    console.error("[/getdates] Processing error:", err);
    res.status(500).json({ error: "Failed to process image collection" });
  }
});

// === SERVER ===
const server = app.listen(port, () => {
  const host = server.address().address;
  const actualHost = host === "::" ? "localhost" : host;
  const actualPort = server.address().port;
  console.log(`✅ Server running at http://${actualHost}:${actualPort}`);
});
