# Aturan ProGuard untuk Tracking Delivery Order - PIF
-keepclassmembers class com.pif.trackingdo.MainActivity$AndroidBridge {
    @android.webkit.JavascriptInterface <methods>;
}

