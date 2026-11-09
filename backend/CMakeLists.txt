cmake_minimum_required(VERSION 3.16)

project(neon_rush_sim LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenMP COMPONENTS CXX QUIET)
find_package(MPI COMPONENTS CXX QUIET)

add_library(neon_rush_core
  src/Vehicle.cpp
  src/CollisionSystem.cpp
  src/Simulation.cpp
)

target_include_directories(neon_rush_core
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

if(OpenMP_CXX_FOUND)
  target_link_libraries(neon_rush_core PUBLIC OpenMP::OpenMP_CXX)
  message(STATUS "OpenMP support enabled")
else()
  message(WARNING "OpenMP was not found; --mode openmp will use sequential execution")
endif()

if(MPI_CXX_FOUND)
  target_sources(neon_rush_core PRIVATE src/MpiSimulation.cpp)
  target_link_libraries(neon_rush_core PUBLIC MPI::MPI_CXX)
  target_compile_definitions(neon_rush_core PUBLIC NEON_RUSH_HAS_MPI=1)
  message(STATUS "MPI support enabled")
else()
  message(STATUS "MPI was not found; sequential and OpenMP modes remain available")
endif()

target_compile_options(neon_rush_core
  PRIVATE
    $<$<CXX_COMPILER_ID:GNU,Clang>:-Wall;-Wextra;-Wpedantic;-Wconversion>
)

add_executable(neon_rush_sim src/main.cpp)
target_link_libraries(neon_rush_sim PRIVATE neon_rush_core)

add_executable(neon_rush_api src/api_bridge.cpp)
target_link_libraries(neon_rush_api PRIVATE neon_rush_core)

include(CTest)

if(BUILD_TESTING)
  add_executable(neon_rush_tests tests/SimulationTests.cpp)
  target_link_libraries(neon_rush_tests PRIVATE neon_rush_core)
  add_test(NAME neon_rush_simulation_tests COMMAND neon_rush_tests)

  if(MPI_CXX_FOUND AND MPIEXEC_EXECUTABLE)
    add_executable(neon_rush_mpi_tests tests/MpiSimulationTests.cpp)
    target_link_libraries(neon_rush_mpi_tests PRIVATE neon_rush_core)

    foreach(process_count IN ITEMS 1 2 3)
      add_test(
        NAME neon_rush_mpi_tests_${process_count}
        COMMAND
          ${MPIEXEC_EXECUTABLE}
          ${MPIEXEC_NUMPROC_FLAG} ${process_count}
          ${MPIEXEC_PREFLAGS}
          $<TARGET_FILE:neon_rush_mpi_tests>
          ${MPIEXEC_POSTFLAGS}
      )
    endforeach()
  endif()
endif()
