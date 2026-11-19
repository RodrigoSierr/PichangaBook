# Reglas ProGuard / R8 seguras para PichangaBook Arequipa (Flutter + Google Maps + Firebase Auth + ExoPlayer)
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Google Maps & Play Services
-keep class com.google.android.gms.maps.** { *; }
-dontwarn com.google.android.gms.**

# Firebase Auth
-keep class com.google.firebase.auth.** { *; }
-dontwarn com.google.firebase.**

# Mantener atributos para trazas de producción legibles
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable
