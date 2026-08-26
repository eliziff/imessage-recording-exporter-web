from pathlib import Path
import base64
import json
import sys
import time
import zipfile

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By


ROOT = Path(__file__).resolve().parents[1]
SAMPLE = Path(sys.argv[1]).resolve()
TEST_MEDIA = "--media" in sys.argv[2:]
OUTPUT = ROOT / "test-output"
OUTPUT.mkdir(exist_ok=True)

options = Options()
options.binary_location = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
options.add_argument("--headless=new")
options.add_argument("--window-size=1280,1400")
options.add_argument("--disable-gpu")
options.add_argument("--autoplay-policy=no-user-gesture-required")
options.add_experimental_option("prefs", {"download.default_directory": str(OUTPUT), "download.prompt_for_download": False})
options.set_capability("goog:loggingPrefs", {"browser": "ALL"})

driver = webdriver.Chrome(options=options)
try:
    driver.get("http://127.0.0.1:8769/")
    driver.find_element(By.ID, "recording").send_keys(str(SAMPLE))
    name = "browser-smoke-export"
    base_name = driver.find_element(By.ID, "base-name")
    base_name.clear()
    base_name.send_keys(" browser / smoke export ")
    driver.find_element(By.ID, "process").click()
    deadline = time.time() + 900
    last_status = None
    while time.time() < deadline:
        error = driver.find_element(By.ID, "file-error").text
        if error:
            raise RuntimeError(error)
        if not driver.find_element(By.ID, "results").get_attribute("hidden"):
            break
        status = driver.find_element(By.ID, "status").text
        if status != last_status:
            print(status, flush=True)
            last_status = status
        time.sleep(1)
    else:
        raise TimeoutError(driver.find_element(By.ID, "status").text)

    zip_path = OUTPUT / f"{name}-images.zip"
    zip_path.unlink(missing_ok=True)
    driver.find_element(By.ID, "zip-download").click()
    zip_deadline = time.time() + 120
    while time.time() < zip_deadline and not zip_path.exists():
        time.sleep(0.5)
    if not zip_path.exists():
        raise TimeoutError("Image ZIP download did not finish")
    with zipfile.ZipFile(zip_path) as archive:
        zip_names = archive.namelist()
    expected_zip_names = [
        f"{name}-image-{number:04d}.png"
        for number in range(1, len(zip_names) + 1)
    ]
    if not zip_names or zip_names != expected_zip_names:
        raise AssertionError(f"Unexpected ZIP names: {zip_names}")

    pdf_path = OUTPUT / f"{name}-paginated.pdf"
    pdf_path.unlink(missing_ok=True)
    driver.find_element(By.ID, "pdf-download").click()
    pdf_deadline = time.time() + 120
    while time.time() < pdf_deadline and not pdf_path.exists():
        time.sleep(0.5)
    if not pdf_path.exists():
        raise TimeoutError("PDF download did not finish")

    media = {}
    if TEST_MEDIA:
        driver.execute_script("document.querySelector('#clip-start').value = '0'; document.querySelector('#clip-end').value = '0.8';")
        for kind, extension in (("video", "mp4"), ("audio", "m4a")):
            media[kind] = []
            for number in (1, 2):
                path = OUTPUT / f"{name}-{kind}-{number:04d}.{extension}"
                path.unlink(missing_ok=True)
                driver.find_element(By.ID, f"{kind}-download").click()
                media_deadline = time.time() + 300
                while time.time() < media_deadline and not path.exists():
                    status = driver.find_element(By.ID, "media-status").text
                    if status.startswith("Unable") or status.startswith("No audio"):
                        raise RuntimeError(status)
                    time.sleep(0.5)
                if not path.exists():
                    raise TimeoutError(f"{kind.title()} download {number} did not finish")
                media[kind].append(path.stat().st_size)

    result = {
        "summary": driver.find_element(By.ID, "result-summary").text,
        "diagnostics": json.loads(driver.find_element(By.ID, "diagnostics").get_attribute("textContent")),
        "continuous_name": driver.find_element(By.ID, "continuous-download").get_attribute("download"),
        "zip_names": zip_names,
        "pdf_bytes": pdf_path.stat().st_size,
        "media_bytes": media,
        "browser_logs": driver.get_log("browser"),
    }
    if result["continuous_name"] != f"{name}-contiguous.jpg":
        raise AssertionError(result["continuous_name"])
    screenshot = OUTPUT / f"{SAMPLE.stem}.png"
    driver.save_screenshot(str(screenshot))
    data_url = driver.execute_async_script("""
      const done = arguments[0];
      fetch(document.querySelector('#continuous-download').href)
        .then(response => response.blob())
        .then(blob => { const reader = new FileReader(); reader.onload = () => done(reader.result); reader.readAsDataURL(blob); })
        .catch(error => done(`ERROR:${error.message}`));
    """)
    if not data_url.startswith("ERROR:"):
        (OUTPUT / f"{name}-contiguous.jpg").write_bytes(base64.b64decode(data_url.split(",", 1)[1]))
    print(json.dumps(result, indent=2))
finally:
    driver.quit()
