plugins { id("com.android.application") }
android {
    namespace = "com.sceneforge.studio"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.sceneforge.studio"
        minSdk = 26
        targetSdk = 35
        versionCode = 15
        versionName = "0.15-debug"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
        getByName("release") { isMinifyEnabled = false }
    }
}

dependencies {
    // Restrict the JavaScript message bridge to the exact trusted web origin.
    implementation("androidx.webkit:webkit:1.16.0")
}
