import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    FileInputStream(keystorePropertiesFile).use { keystoreProperties.load(it) }
}

val releaseStoreFile = (keystoreProperties.getProperty("storeFile")
    ?: System.getenv("PICHANGA_KEYSTORE_PATH")
    ?: "").trim()
val releaseStorePassword = (keystoreProperties.getProperty("storePassword")
    ?: System.getenv("PICHANGA_KEYSTORE_PASSWORD")
    ?: "").trim()
val releaseKeyAlias = (keystoreProperties.getProperty("keyAlias")
    ?: System.getenv("PICHANGA_KEY_ALIAS")
    ?: "").trim()
val releaseKeyPassword = (keystoreProperties.getProperty("keyPassword")
    ?: System.getenv("PICHANGA_KEY_PASSWORD")
    ?: "").trim()
val mapsApiKey = (keystoreProperties.getProperty("MAPS_API_KEY")
    ?: System.getenv("MAPS_API_KEY")
    ?: "CONFIGURE_GOOGLE_MAPS_API_KEY").trim()

val hasReleaseKeystore = releaseStoreFile.isNotEmpty() &&
    releaseStorePassword.isNotEmpty() &&
    releaseKeyAlias.isNotEmpty() &&
    releaseKeyPassword.isNotEmpty()

val isReleaseTaskRequested = gradle.startParameter.taskNames.any {
    it.contains("Release", ignoreCase = true)
}
if (isReleaseTaskRequested && !hasReleaseKeystore) {
    throw GradleException(
        "Compilación Release bloqueada: configura android/key.properties o las variables PICHANGA_KEYSTORE_* " +
        "para firmar el APK de distribución sin usar llaves debug."
    )
}

android {
    namespace = "com.pichangabook.pichangabook_mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.pichangabook.pichangabook_mobile"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["MAPS_API_KEY"] = mapsApiKey
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = file(releaseStoreFile)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            if (hasReleaseKeystore) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
