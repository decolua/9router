plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android { namespace = "com.btu.cinema"; compileSdk = 35
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 defaultConfig { applicationId = "com.btu.cinema"; minSdk = 29; targetSdk = 35; versionCode = 1; versionName = "0.1" }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { implementation("androidx.core:core:1.15.0") }
