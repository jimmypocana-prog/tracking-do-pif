package com.pif.trackingdo;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.LocationManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.text.InputType;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private static final String PREFS_NAME = "pif_do_apk_prefs";
    private static final String KEY_WEB_URL = "web_url";

    private static final int REQ_LOCATION_STARTUP = 1001;
    private static final int REQ_LOCATION_WEB = 1002;
    private static final int REQ_CAMERA = 1003;
    private static final int REQ_STORAGE = 1004;

    private WebView webView;
    private LinearLayout errorOverlay;
    private TextView errorTitleView;
    private TextView errorDescView;

    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;

    private ValueCallback<Uri[]> pendingFileCallback;
    private Uri cameraPhotoUri;
    private File lastCameraFile;
    private boolean pendingCaptureOnly = false;
    private boolean pendingAllowMultiple = false;

    private String pendingSaveData;
    private String pendingSaveName;
    private String pendingSaveMime;

    private boolean mainFrameHadError = false;
    private String currentTargetUrl = "";

    private final ActivityResultLauncher<Intent> fileChooserLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (pendingFileCallback == null) {
                    return;
                }
                Uri[] results = null;
                try {
                    if (result.getResultCode() == Activity.RESULT_OK) {
                        Intent data = result.getData();
                        List<Uri> uriList = new ArrayList<>();
                        if (data != null && data.getClipData() != null) {
                            ClipData clip = data.getClipData();
                            for (int i = 0; i < clip.getItemCount(); i++) {
                                Uri itemUri = clip.getItemAt(i).getUri();
                                if (itemUri != null) {
                                    uriList.add(itemUri);
                                }
                            }
                        } else if (data != null && data.getData() != null) {
                            uriList.add(data.getData());
                        } else if (cameraPhotoUri != null && lastCameraFile != null && lastCameraFile.exists() && lastCameraFile.length() > 0) {
                            uriList.add(cameraPhotoUri);
                        }
                        if (!uriList.isEmpty()) {
                            results = uriList.toArray(new Uri[0]);
                        }
                    }
                } catch (Exception ignored) {
                    results = null;
                } finally {
                    pendingFileCallback.onReceiveValue(results);
                    pendingFileCallback = null;
                    cameraPhotoUri = null;
                }
            });

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        root.addView(webView);

        errorOverlay = buildErrorOverlay();
        errorOverlay.setVisibility(View.GONE);
        root.addView(errorOverlay);

        setContentView(root);

        configureWebView();
        setupBackNavigation();
        ensureStartupLocationPermission();
        loadConfiguredAppUrl();
    }

    private LinearLayout buildErrorOverlay() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#F8FAFC"));
        int pad = dpToPx(24);
        box.setPadding(pad, pad, pad, pad);

        errorTitleView = new TextView(this);
        errorTitleView.setTextColor(Color.parseColor("#0F172A"));
        errorTitleView.setTextSize(19);
        errorTitleView.setGravity(Gravity.CENTER);
        box.addView(errorTitleView);

        errorDescView = new TextView(this);
        errorDescView.setTextColor(Color.parseColor("#475569"));
        errorDescView.setTextSize(14);
        errorDescView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams descParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        descParams.topMargin = dpToPx(10);
        descParams.bottomMargin = dpToPx(20);
        box.addView(errorDescView, descParams);

        Button retryBtn = new Button(this);
        retryBtn.setText("Muat Ulang Aplikasi");
        retryBtn.setBackgroundColor(Color.parseColor("#2563EB"));
        retryBtn.setTextColor(Color.WHITE);
        retryBtn.setOnClickListener(v -> loadConfiguredAppUrl());
        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        btnParams.bottomMargin = dpToPx(10);
        box.addView(retryBtn, btnParams);

        Button configBtn = new Button(this);
        configBtn.setText("Atur URL Website (GitHub Pages)");
        configBtn.setBackgroundColor(Color.parseColor("#E2E8F0"));
        configBtn.setTextColor(Color.parseColor("#0F172A"));
        configBtn.setOnClickListener(v -> showUrlSetupDialog(false));
        box.addView(configBtn, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        return box;
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidApp");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!mainFrameHadError) {
                    errorOverlay.setVisibility(View.GONE);
                    webView.setVisibility(View.VISIBLE);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request != null && request.isForMainFrame()) {
                    mainFrameHadError = true;
                    String desc = error != null && error.getDescription() != null
                            ? error.getDescription().toString()
                            : "Tidak dapat terhubung ke server.";
                    showErrorState("Koneksi Terkendala",
                            "Gagal memuat: " + currentTargetUrl + "\n(" + desc + ")\n\nPastikan internet HP aktif dan alamat URL sudah benar.");
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                super.onReceivedHttpError(view, request, errorResponse);
                if (request != null && request.isForMainFrame() && errorResponse != null && errorResponse.getStatusCode() >= 400) {
                    mainFrameHadError = true;
                    showErrorState("Halaman Tidak Ditemukan (HTTP " + errorResponse.getStatusCode() + ")",
                            "Alamat " + currentTargetUrl + " mengembalikan status " + errorResponse.getStatusCode() + ". Klik tombol di bawah jika perlu memperbarui URL GitHub Pages Anda.");
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) {
                    return false;
                }
                Uri uri = request.getUrl();
                String url = uri.toString();
                String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
                String host = uri.getHost() != null ? uri.getHost().toLowerCase() : "";

                boolean isExternalApp =
                        scheme.equals("whatsapp")
                                || scheme.equals("tel")
                                || scheme.equals("geo")
                                || scheme.equals("mailto")
                                || scheme.equals("intent")
                                || host.equals("wa.me")
                                || host.equals("api.whatsapp.com")
                                || host.equals("maps.google.com")
                                || host.equals("maps.app.goo.gl")
                                || (host.equals("www.google.com") && url.contains("/maps"));

                if (isExternalApp) {
                    openExternalUri(uri);
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                boolean allowedOrigin = origin != null
                        && (origin.startsWith("https://") || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1"));
                if (!allowedOrigin) {
                    callback.invoke(origin, false, false);
                    return;
                }

                if (hasLocationPermission()) {
                    warnIfDeviceLocationDisabled();
                    callback.invoke(origin, true, true);
                    return;
                }

                if (pendingGeoCallback != null) {
                    pendingGeoCallback.invoke(pendingGeoOrigin, false, false);
                }
                pendingGeoOrigin = origin;
                pendingGeoCallback = callback;
                ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
                        REQ_LOCATION_WEB
                );
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                    pendingFileCallback = null;
                }
                pendingFileCallback = filePathCallback;

                boolean captureOnly = fileChooserParams != null && fileChooserParams.isCaptureEnabled();
                boolean allowMultiple = fileChooserParams != null
                        && fileChooserParams.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;

                if (captureOnly && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                        != PackageManager.PERMISSION_GRANTED) {
                    pendingCaptureOnly = true;
                    pendingAllowMultiple = allowMultiple;
                    ActivityCompat.requestPermissions(
                            MainActivity.this,
                            new String[]{Manifest.permission.CAMERA},
                            REQ_CAMERA
                    );
                    return true;
                }

                launchFilePicker(captureOnly, allowMultiple);
                return true;
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                if (url == null) {
                    return;
                }
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    String suggested = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    if (suggested == null || suggested.trim().isEmpty() || suggested.equals("downloadfile.bin")) {
                        suggested = "Laporan_Delivery_PIF";
                    }
                    String safeUrl = url.replace("\\", "\\\\").replace("'", "\\'");
                    String safeName = suggested.replace("\\", "\\\\").replace("'", "\\'");
                    String safeMime = (mimeType != null ? mimeType : "").replace("\\", "\\\\").replace("'", "\\'");
                    String js =
                            "(function(){" +
                            "fetch('" + safeUrl + "').then(function(r){return r.blob();}).then(function(b){" +
                            "var fr=new FileReader();" +
                            "fr.onloadend=function(){if(window.AndroidApp){window.AndroidApp.saveBase64File(fr.result,'" + safeName + "',b.type||'" + safeMime + "');}};" +
                            "fr.readAsDataURL(b);" +
                            "}).catch(function(){});" +
                            "})();";
                    webView.evaluateJavascript(js, null);
                } else {
                    openExternalUri(Uri.parse(url));
                }
            }
        });
    }

    private void setupBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (errorOverlay.getVisibility() == View.VISIBLE) {
                    finish();
                    return;
                }
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("Keluar Aplikasi")
                        .setMessage("Tutup Tracking Delivery Order - PIF?")
                        .setPositiveButton("Keluar", (d, w) -> finish())
                        .setNegativeButton("Batal", null)
                        .show();
            }
        });
    }

    private String getSavedOrDefaultUrl() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String saved = prefs.getString(KEY_WEB_URL, "");
        if (saved != null && !saved.trim().isEmpty()) {
            return saved.trim();
        }
        String def = getString(R.string.default_web_url);
        return def != null ? def.trim() : "";
    }

    private void loadConfiguredAppUrl() {
        String url = getSavedOrDefaultUrl();
        if (url.isEmpty()) {
            showErrorState("Alamat Website Belum Diatur",
                    "Silakan masukkan URL GitHub Pages (https://...) aplikasi Tracking Delivery Order - PIF Anda.");
            showUrlSetupDialog(true);
            return;
        }
        mainFrameHadError = false;
        currentTargetUrl = url;
        errorOverlay.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        webView.loadUrl(url);
    }

    private void showErrorState(String title, String desc) {
        runOnUiThread(() -> {
            errorTitleView.setText(title);
            errorDescView.setText(desc);
            webView.setVisibility(View.GONE);
            errorOverlay.setVisibility(View.VISIBLE);
        });
    }

    private void showUrlSetupDialog(boolean initialPrompt) {
        runOnUiThread(() -> {
            EditText input = new EditText(MainActivity.this);
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
            input.setHint("https://username.github.io/nama-repo/");
            input.setText(getSavedOrDefaultUrl());

            LinearLayout container = new LinearLayout(MainActivity.this);
            container.setOrientation(LinearLayout.VERTICAL);
            int pad = dpToPx(20);
            container.setPadding(pad, dpToPx(10), pad, dpToPx(4));
            container.addView(input);

            AlertDialog.Builder builder = new AlertDialog.Builder(MainActivity.this)
                    .setTitle(initialPrompt ? "Hubungkan URL Aplikasi" : "Atur URL Website Aplikasi")
                    .setMessage("Masukkan alamat HTTPS GitHub Pages aplikasi Tracking Delivery Order - PIF Anda:")
                    .setView(container)
                    .setCancelable(!initialPrompt)
                    .setPositiveButton("Simpan & Buka", (dialog, which) -> {
                        String raw = input.getText() != null ? input.getText().toString().trim() : "";
                        if (!raw.startsWith("https://")) {
                            Toast.makeText(MainActivity.this, "URL wajib diawali https:// agar GPS & Kamera berfungsi.", Toast.LENGTH_LONG).show();
                            return;
                        }
                        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                                .edit()
                                .putString(KEY_WEB_URL, raw)
                                .apply();
                        loadConfiguredAppUrl();
                    });

            if (!initialPrompt) {
                builder.setNegativeButton("Batal", null);
            }
            builder.show();
        });
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void ensureStartupLocationPermission() {
        if (!hasLocationPermission()) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
                    REQ_LOCATION_STARTUP
            );
        } else {
            warnIfDeviceLocationDisabled();
        }
    }

    private void warnIfDeviceLocationDisabled() {
        try {
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) {
                return;
            }
            boolean gpsOn = lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
            boolean netOn = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            if (!gpsOn && !netOn) {
                new AlertDialog.Builder(this)
                        .setTitle("GPS HP Belum Menyala")
                        .setMessage("Fitur Lokasi/GPS pada HP sedang mati. Nyalakan GPS HP agar Check-In, Check-Out, dan Gagal Kirim bisa mengambil koordinat.")
                        .setPositiveButton("Buka Setelan Lokasi", (d, w) ->
                                startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)))
                        .setNegativeButton("Nanti", null)
                        .show();
            }
        } catch (Exception ignored) {
        }
    }

    private void showAppPermissionSettingsDialog(String title, String message) {
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton("Buka Setelan Aplikasi", (d, w) -> {
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.fromParts("package", getPackageName(), null));
                    startActivity(intent);
                })
                .setNegativeButton("Tutup", null)
                .show();
    }

    private void launchFilePicker(boolean captureOnly, boolean allowMultiple) {
        try {
            Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            File photoFile = new File(getCacheDir(), "pif_cam_" + System.currentTimeMillis() + ".jpg");
            lastCameraFile = photoFile;
            cameraPhotoUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", photoFile);
            cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraPhotoUri);
            cameraIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);

            if (captureOnly) {
                fileChooserLauncher.launch(cameraIntent);
                return;
            }

            Intent galleryIntent = new Intent(Intent.ACTION_GET_CONTENT);
            galleryIntent.addCategory(Intent.CATEGORY_OPENABLE);
            galleryIntent.setType("image/*");
            if (allowMultiple) {
                galleryIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }

            Intent chooser = Intent.createChooser(galleryIntent, "Pilih Foto atau Ambil Kamera");
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                    && cameraIntent.resolveActivity(getPackageManager()) != null) {
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cameraIntent});
            }
            fileChooserLauncher.launch(chooser);
        } catch (Exception e) {
            Toast.makeText(this, "Gagal membuka kamera/galeri: " + e.getMessage(), Toast.LENGTH_LONG).show();
            if (pendingFileCallback != null) {
                pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = null;
            }
        }
    }

    private void openExternalUri(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
        } catch (Exception e) {
            Toast.makeText(this, "Tidak ada aplikasi untuk membuka tautan ini.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == REQ_LOCATION_STARTUP) {
            if (hasLocationPermission()) {
                warnIfDeviceLocationDisabled();
            } else {
                Toast.makeText(this, "Izinkan Lokasi agar Check-In & Check-Out GPS dapat berjalan.", Toast.LENGTH_LONG).show();
            }
            return;
        }

        if (requestCode == REQ_LOCATION_WEB) {
            boolean granted = hasLocationPermission();
            if (pendingGeoCallback != null) {
                pendingGeoCallback.invoke(pendingGeoOrigin, granted, granted);
                pendingGeoCallback = null;
                pendingGeoOrigin = null;
            }
            if (granted) {
                warnIfDeviceLocationDisabled();
            } else if (!ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.ACCESS_FINE_LOCATION)) {
                showAppPermissionSettingsDialog(
                        "Izin Lokasi Diblokir",
                        "Anda sebelumnya menolak izin Lokasi. Aktifkan izin Lokasi melalui Setelan Aplikasi agar bisa mengambil titik GPS."
                );
            }
            return;
        }

        if (requestCode == REQ_CAMERA) {
            boolean camGranted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (camGranted) {
                launchFilePicker(pendingCaptureOnly, pendingAllowMultiple);
            } else {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                    pendingFileCallback = null;
                }
                showAppPermissionSettingsDialog(
                        "Izin Kamera Dibutuhkan",
                        "Aktifkan izin Kamera pada Setelan Aplikasi untuk mengambil foto langsung dari aplikasi."
                );
            }
            return;
        }

        if (requestCode == REQ_STORAGE) {
            boolean storageGranted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (storageGranted && pendingSaveData != null) {
                saveBase64ToDownloads(pendingSaveData, pendingSaveName, pendingSaveMime);
            } else {
                Toast.makeText(this, "Izin penyimpanan ditolak. File tidak dapat disimpan.", Toast.LENGTH_LONG).show();
            }
            pendingSaveData = null;
            pendingSaveName = null;
            pendingSaveMime = null;
        }
    }

    private void saveBase64ToDownloads(String dataUrlOrBase64, String fileName, String mimeType) {
        try {
            String base64Part = dataUrlOrBase64;
            int commaIdx = dataUrlOrBase64.indexOf(',');
            if (commaIdx != -1) {
                base64Part = dataUrlOrBase64.substring(commaIdx + 1);
            }
            byte[] bytes = Base64.decode(base64Part.trim(), Base64.DEFAULT);
            String cleanName = (fileName == null || fileName.trim().isEmpty())
                    ? "Laporan_Delivery_PIF.bin"
                    : fileName.trim().replaceAll("[^a-zA-Z0-9._-]", "_");
            String resolvedMime = (mimeType == null || mimeType.trim().isEmpty())
                    ? "application/octet-stream"
                    : mimeType.trim();

            Uri savedUri = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, cleanName);
                values.put(MediaStore.Downloads.MIME_TYPE, resolvedMime);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/PIF-Delivery");
                values.put(MediaStore.Downloads.IS_PENDING, 1);

                savedUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (savedUri == null) {
                    throw new IllegalStateException("Gagal membuat file di folder Downloads.");
                }
                try (OutputStream out = resolver.openOutputStream(savedUri)) {
                    if (out == null) {
                        throw new IllegalStateException("Stream output gagal dibuka.");
                    }
                    out.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(savedUri, values, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "PIF-Delivery");
                if (!dir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                }
                File outFile = new File(dir, cleanName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(bytes);
                }
                MediaScannerConnection.scanFile(this, new String[]{outFile.getAbsolutePath()}, new String[]{resolvedMime}, null);
                savedUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", outFile);
            }

            final Uri finalUri = savedUri;
            runOnUiThread(() -> {
                Toast.makeText(MainActivity.this, "Tersimpan di Download/PIF-Delivery/" + cleanName, Toast.LENGTH_LONG).show();
                if (finalUri != null) {
                    new AlertDialog.Builder(MainActivity.this)
                            .setTitle("File Laporan Berhasil Diunduh")
                            .setMessage("Tersimpan di folder Download/PIF-Delivery/" + cleanName)
                            .setPositiveButton("Buka File", (d, w) -> {
                                try {
                                    Intent viewIntent = new Intent(Intent.ACTION_VIEW);
                                    viewIntent.setDataAndType(finalUri, resolvedMime);
                                    viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                    startActivity(viewIntent);
                                } catch (Exception ex) {
                                    Toast.makeText(MainActivity.this, "File tersimpan di folder Download HP Anda.", Toast.LENGTH_LONG).show();
                                }
                            })
                            .setNegativeButton("Tutup", null)
                            .show();
                }
            });
        } catch (Exception e) {
            runOnUiThread(() ->
                    Toast.makeText(MainActivity.this, "Gagal menyimpan file: " + e.getMessage(), Toast.LENGTH_LONG).show()
            );
        }
    }

    public class AndroidBridge {
        @JavascriptInterface
        public boolean isAndroidApk() {
            return true;
        }

        @JavascriptInterface
        public boolean hasLocationPermissionFromApp() {
            return hasLocationPermission();
        }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> showAppPermissionSettingsDialog(
                    "Izin Aplikasi Diperlukan",
                    "Pastikan izin Lokasi & Kamera diaktifkan di Setelan Aplikasi HP Anda."
            ));
        }

        @JavascriptInterface
        public void openUrlSettings() {
            showUrlSetupDialog(false);
        }

        @JavascriptInterface
        public void saveBase64File(final String dataUrlOrBase64, final String fileName, final String mimeType) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                    && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                pendingSaveData = dataUrlOrBase64;
                pendingSaveName = fileName;
                pendingSaveMime = mimeType;
                runOnUiThread(() -> ActivityCompat.requestPermissions(
                        MainActivity.this,
                        new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},
                        REQ_STORAGE
                ));
                return;
            }
            saveBase64ToDownloads(dataUrlOrBase64, fileName, mimeType);
        }
    }
}

