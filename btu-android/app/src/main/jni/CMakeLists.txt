# BTU JNI scaffold. Requires ExecuTorch runtime headers and linked libraries.
# Do not enable in app/build.gradle.kts until a compatible ExecuTorch Android SDK is supplied.
cmake_minimum_required(VERSION 3.22.1)
project(btu_cinema_runtime LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
add_library(btu_cinema_runtime SHARED BtuCinemaRuntime.cpp)
# Configure ExecuTorch headers and libraries for the chosen SDK release.
# target_include_directories(btu_cinema_runtime PRIVATE <executorch-include-dir>)
# target_link_libraries(btu_cinema_runtime PRIVATE <executorch-runtime-target> log)
