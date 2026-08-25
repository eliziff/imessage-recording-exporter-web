from pathlib import Path
import base64
import json
import sys
import time

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By


ROOT = Path(__file__).resolve().parents[1]
SAMPLE = Path(sys.argv[1]).resolve()
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

    pdf_path = OUTPUT / f"{SAMPLE.stem}.pdf"
    pdf_path.unlink(missing_ok=True)
    driver.find_element(By.ID, "pdf-download").click()
    pdf_deadline = time.time() + 120
    while time.time() < pdf_deadline and not pdf_path.exists():
        time.sleep(0.5)
    if not pdf_path.exists():
        raise TimeoutError("PDF download did not finish")

    result = {
        "summary": driver.find_element(By.ID, "result-summary").text,
        "diagnostics": json.loads(driver.find_element(By.ID, "diagnostics").get_attribute("textContent")),
        "page_links": len(driver.find_elements(By.CSS_SELECTOR, "#page-downloads a")),
        "pdf_bytes": pdf_path.stat().st_size,
        "browser_logs": driver.get_log("browser"),
    }
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
        (OUTPUT / f"{SAMPLE.stem}-continuous.jpg").write_bytes(base64.b64decode(data_url.split(",", 1)[1]))
    print(json.dumps(result, indent=2))
finally:
    driver.quit()
