plugins {
    // AGP 9 ships built-in Kotlin support; no separate Kotlin plugin wanted.
    id("com.android.application") version "9.3.0"
}

android {
    namespace = "io.github.munzzyy.puzzlepress"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.munzzyy.puzzlepress"
        minSdk = 24
        targetSdk = 36
        versionCode = 10000
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            // Unsigned on purpose: F-Droid signs with its own key.
            isMinifyEnabled = false
            isShrinkResources = false
            vcsInfo.include = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencyLocking {
    lockAllConfigurations()
}

// The web app IS the app. Only the files a page actually loads at runtime
// are synced in: no android/, tests/, tools/, docs/, _shots/ or dev files.
val syncWebAssets = tasks.register<Sync>("syncWebAssets") {
    val webDir = rootProject.layout.projectDirectory.dir("..")
    from(webDir) {
        include("index.html", "archive.html", "manifest.webmanifest")
        include("assets/**")
        include("games/**")
        include("data/*.json")
        exclude("**/*.test.mjs")
    }
    into(layout.buildDirectory.dir("webassets"))
}

android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("webassets").get().asFile)

tasks.named("preBuild") {
    dependsOn(syncWebAssets)
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.webkit:webkit:1.14.0")
}
