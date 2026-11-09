#include "Simulation.hpp"

#ifdef NEON_RUSH_HAS_MPI
#include "MpiSimulation.hpp"
#include <mpi.h>
#endif

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

struct Options {
  std::size_t vehicles = 4;
  std::size_t steps = 1000;
  std::size_t repetitions = 5;
  int threads = 1;
  double deltaTime = 1.0 / 60.0;
  neon_rush::ExecutionMode mode =
      neon_rush::ExecutionMode::Sequential;
  bool compare = false;
  bool sweep = false;
  bool compareMpi = false;
  bool help = false;
};

struct Sample {
  double movementSeconds = 0.0;
  double collisionSeconds = 0.0;
  double totalSeconds = 0.0;
  std::size_t collisions = 0;
  double checksum = 0.0;
  double communicationSeconds = 0.0;
  std::vector<neon_rush::Vehicle> vehicles;
  std::vector<neon_rush::GlobalCollisionPair> collisionPairs;
};

std::size_t parseSize(const std::string_view value,
                      const std::string_view option) {
  std::size_t parsed = 0;
  const auto result =
      std::from_chars(value.data(), value.data() + value.size(), parsed);
  if (result.ec != std::errc{} ||
      result.ptr != value.data() + value.size()) {
    throw std::invalid_argument(
        "invalid value for " + std::string(option));
  }
  return parsed;
}

int parseThreads(const std::string_view value) {
  const auto parsed = parseSize(value, "--threads");
  if (parsed > static_cast<std::size_t>(
                   std::numeric_limits<int>::max())) {
    throw std::invalid_argument("--threads value is too large");
  }
  return static_cast<int>(parsed);
}

double parseDouble(const std::string_view value,
                   const std::string_view option) {
  std::string text(value);
  char* end = nullptr;
  const double parsed = std::strtod(text.c_str(), &end);
  if (end != text.c_str() + text.size() || !std::isfinite(parsed)) {
    throw std::invalid_argument(
        "invalid value for " + std::string(option));
  }
  return parsed;
}

void printHelp() {
  std::cout
      << "Usage: neon_rush_sim [options]\n"
      << "  --vehicles N             Number of vehicles (default: 4)\n"
      << "  --steps N                Simulation steps (default: 1000)\n"
      << "  --delta-time SECONDS     Step duration (default: 1/60)\n"
      << "  --mode sequential|openmp|compare|sweep (default: sequential)\n"
#ifdef NEON_RUSH_HAS_MPI
      << "  --mode mpi|mpi-compare    Distributed MPI run/benchmark\n"
#endif
      << "  --threads N              OpenMP threads (default: 1)\n"
      << "  --repetitions N          Benchmark repetitions (default: 5)\n"
      << "  --help                   Show this help\n";
}

Options parseOptions(const int argc, char** argv) {
  Options options;
  for (int index = 1; index < argc; ++index) {
    const std::string_view option(argv[index]);
    if (option == "--help" || option == "-h") {
      options.help = true;
      return options;
    }

    if (index + 1 >= argc) {
      throw std::invalid_argument(
          "missing value for " + std::string(option));
    }

    const std::string_view value(argv[++index]);
    if (option == "--vehicles") {
      options.vehicles = parseSize(value, option);
    } else if (option == "--steps") {
      options.steps = parseSize(value, option);
    } else if (option == "--delta-time") {
      options.deltaTime = parseDouble(value, option);
    } else if (option == "--threads") {
      options.threads = parseThreads(value);
    } else if (option == "--repetitions") {
      options.repetitions = parseSize(value, option);
    } else if (option == "--mode") {
      options.compare = false;
      options.sweep = false;
      options.compareMpi = false;
      if (value == "sequential") {
        options.mode = neon_rush::ExecutionMode::Sequential;
      } else if (value == "openmp") {
        options.mode = neon_rush::ExecutionMode::OpenMP;
      } else if (value == "mpi") {
        options.mode = neon_rush::ExecutionMode::MPI;
      } else if (value == "mpi-compare") {
        options.mode = neon_rush::ExecutionMode::MPI;
        options.compareMpi = true;
      } else if (value == "compare") {
        options.compare = true;
      } else if (value == "sweep") {
        options.sweep = true;
      } else {
        throw std::invalid_argument(
            "--mode must be sequential, openmp, compare, sweep, mpi, or mpi-compare");
      }
    } else {
      throw std::invalid_argument(
          "unknown option: " + std::string(option));
    }
  }

  if (options.vehicles == 0) {
    throw std::invalid_argument("--vehicles must be greater than zero");
  }
  if (options.deltaTime < 0.0) {
    throw std::invalid_argument("--delta-time cannot be negative");
  }
  if (options.threads < 1 ||
      options.threads > neon_rush::availableThreadCount()) {
    throw std::invalid_argument(
        "--threads must be between 1 and the available processor count (" +
        std::to_string(neon_rush::availableThreadCount()) + ")");
  }
  if (options.repetitions == 0) {
    throw std::invalid_argument(
        "--repetitions must be greater than zero");
  }
  if ((options.compare || options.sweep) &&
      !neon_rush::openMPSupported()) {
    throw std::runtime_error(
        "compare and sweep modes require a build with OpenMP support");
  }
#ifndef NEON_RUSH_HAS_MPI
  if (options.mode == neon_rush::ExecutionMode::MPI) {
    throw std::runtime_error(
        "MPI mode is unavailable; configure CMake with MPI installed");
  }
#endif
  return options;
}

double checksum(const std::vector<neon_rush::Vehicle>& vehicles) {
  double value = 0.0;
  for (const auto& vehicle : vehicles) {
    value += (static_cast<double>(vehicle.id) + 1.0) *
             (vehicle.x + vehicle.z);
  }
  return value;
}

Sample runOnce(const Options& options,
               const neon_rush::ExecutionMode mode,
               const int threads) {
  const auto start = std::chrono::steady_clock::now();
  auto simulation = neon_rush::Simulation::create(
      options.vehicles, mode, threads);
  simulation.run(options.steps, options.deltaTime);
  const auto finish = std::chrono::steady_clock::now();

  const auto& state = simulation.state();
  Sample sample;
  sample.movementSeconds = state.vehicleUpdateSeconds;
  sample.collisionSeconds = state.collisionDetectionSeconds;
  sample.totalSeconds =
      std::chrono::duration<double>(finish - start).count();
  sample.collisions = state.collisionCount;
  sample.vehicles = simulation.vehicles();
  sample.checksum = checksum(sample.vehicles);
  return sample;
}

double median(std::vector<double> values) {
  std::sort(values.begin(), values.end());
  const std::size_t middle = values.size() / 2;
  if (values.size() % 2 == 1) {
    return values[middle];
  }
  return (values[middle - 1] + values[middle]) * 0.5;
}

struct Summary {
  double movementSeconds;
  double collisionSeconds;
  double totalSeconds;
  double communicationSeconds;
  std::size_t collisions;
  double checksum;
};

Summary summarize(const std::vector<Sample>& samples) {
  std::vector<double> movement;
  std::vector<double> collisionsTime;
  std::vector<double> total;
  std::vector<double> communication;
  movement.reserve(samples.size());
  collisionsTime.reserve(samples.size());
  total.reserve(samples.size());
  communication.reserve(samples.size());

  for (const auto& sample : samples) {
    movement.push_back(sample.movementSeconds);
    collisionsTime.push_back(sample.collisionSeconds);
    total.push_back(sample.totalSeconds);
    communication.push_back(sample.communicationSeconds);
  }

  const auto& representative = samples[samples.size() / 2];
  return {
      median(std::move(movement)),
      median(std::move(collisionsTime)),
      median(std::move(total)),
      median(std::move(communication)),
      representative.collisions,
      representative.checksum};
}

void verifyEquivalent(const Sample& sequential,
                      const Sample& parallel) {
  if (sequential.collisions != parallel.collisions ||
      sequential.vehicles.size() != parallel.vehicles.size()) {
    throw std::runtime_error(
        "sequential and OpenMP collision counts differ");
  }

  for (std::size_t index = 0;
       index < sequential.vehicles.size();
       ++index) {
    const auto& first = sequential.vehicles[index];
    const auto& second = parallel.vehicles[index];
    if (first.x != second.x || first.z != second.z ||
        first.speed != second.speed ||
        first.direction != second.direction) {
      throw std::runtime_error(
          "sequential and OpenMP vehicle states differ");
    }
  }
}

std::vector<Sample> collectSamples(
    const Options& options,
    const neon_rush::ExecutionMode mode,
    const int threads) {
  std::vector<Sample> samples;
  samples.reserve(options.repetitions);
  for (std::size_t repetition = 0;
       repetition < options.repetitions;
       ++repetition) {
    samples.push_back(runOnce(options, mode, threads));
  }
  return samples;
}

void printRun(const std::string_view label,
              const Summary& summary,
              const int threads,
              const bool includeCommunication = false) {
  std::cout << label
            << " (threads=" << threads << ")\n"
            << "  Median movement time (s): "
            << summary.movementSeconds << '\n'
            << "  Median collision detection time (s): "
            << summary.collisionSeconds << '\n'
            << "  Median total time (s): "
            << summary.totalSeconds << '\n';
  if (includeCommunication) {
    std::cout << "  Median MPI communication time (s): "
              << summary.communicationSeconds << '\n';
  }
  std::cout
            << "  Collision pairs detected: "
            << summary.collisions << '\n'
            << "  State checksum: " << summary.checksum << '\n';
}

void runSingleMode(const Options& options) {
  const auto samples = collectSamples(
      options, options.mode, options.threads);
  const auto summary = summarize(samples);
  const bool fellBack =
      options.mode == neon_rush::ExecutionMode::OpenMP &&
      !neon_rush::openMPSupported();

  std::cout << "Vehicles: " << options.vehicles
            << "\nSteps: " << options.steps
            << "\nDelta time: " << options.deltaTime
            << "\nRepetitions: " << options.repetitions
            << "\nMode: "
            << (options.mode == neon_rush::ExecutionMode::OpenMP
                    ? (fellBack ? "sequential (OpenMP unavailable)"
                                : "openmp")
                    : "sequential")
            << '\n';
  printRun("Result", summary,
           options.mode == neon_rush::ExecutionMode::Sequential ||
                   fellBack
               ? 1
               : options.threads);
}

void runComparison(const Options& options) {
  std::vector<Sample> sequentialSamples;
  std::vector<Sample> parallelSamples;
  sequentialSamples.reserve(options.repetitions);
  parallelSamples.reserve(options.repetitions);

  for (std::size_t repetition = 0;
       repetition < options.repetitions;
       ++repetition) {
    Sample sequential;
    Sample parallel;

    if (repetition % 2 == 0) {
      sequential = runOnce(
          options, neon_rush::ExecutionMode::Sequential, 1);
      parallel = runOnce(
          options, neon_rush::ExecutionMode::OpenMP, options.threads);
    } else {
      parallel = runOnce(
          options, neon_rush::ExecutionMode::OpenMP, options.threads);
      sequential = runOnce(
          options, neon_rush::ExecutionMode::Sequential, 1);
    }

    verifyEquivalent(sequential, parallel);
    sequentialSamples.push_back(std::move(sequential));
    parallelSamples.push_back(std::move(parallel));
  }

  const auto sequential = summarize(sequentialSamples);
  const auto parallel = summarize(parallelSamples);
  const double speedup =
      parallel.totalSeconds > 0.0
          ? sequential.totalSeconds / parallel.totalSeconds
          : 0.0;
  const double efficiency = speedup / options.threads;

  std::cout << "Comparable benchmark\n"
            << "Vehicles: " << options.vehicles
            << "\nSteps: " << options.steps
            << "\nDelta time: " << options.deltaTime
            << "\nRepetitions: " << options.repetitions
            << "\nOpenMP available processors: "
            << neon_rush::availableThreadCount()
            << "\nMatching state and collision counts: yes\n";
  printRun("Sequential", sequential, 1);
  printRun("OpenMP", parallel, options.threads);
  std::cout << "  Speedup S(p): " << speedup << '\n'
            << "  Efficiency E(p): " << efficiency << '\n';
}

void runSweep(const Options& options) {
  std::vector<int> threadCounts;
  for (int threads = 1; threads <= options.threads;) {
    threadCounts.push_back(threads);
    if (threads > options.threads / 2) {
      break;
    }
    threads *= 2;
  }
  if (threadCounts.back() != options.threads) {
    threadCounts.push_back(options.threads);
  }

  std::vector<Sample> sequentialSamples;
  std::vector<std::vector<Sample>> parallelSamples(
      threadCounts.size());
  sequentialSamples.reserve(options.repetitions);
  for (auto& samples : parallelSamples) {
    samples.reserve(options.repetitions);
  }

  for (std::size_t repetition = 0;
       repetition < options.repetitions;
       ++repetition) {
    Sample sequential;

    if (repetition % 2 == 0) {
      sequential = runOnce(
          options, neon_rush::ExecutionMode::Sequential, 1);
      for (std::size_t index = 0;
           index < threadCounts.size();
           ++index) {
        auto parallel = runOnce(
            options,
            neon_rush::ExecutionMode::OpenMP,
            threadCounts[index]);
        verifyEquivalent(sequential, parallel);
        parallelSamples[index].push_back(std::move(parallel));
      }
    } else {
      for (std::size_t reverse = threadCounts.size();
           reverse > 0;
           --reverse) {
        const std::size_t index = reverse - 1;
        auto parallel = runOnce(
            options,
            neon_rush::ExecutionMode::OpenMP,
            threadCounts[index]);
        parallelSamples[index].push_back(std::move(parallel));
      }
      sequential = runOnce(
          options, neon_rush::ExecutionMode::Sequential, 1);
      for (std::size_t index = 0;
           index < threadCounts.size();
           ++index) {
        verifyEquivalent(sequential, parallelSamples[index].back());
      }
    }

    sequentialSamples.push_back(std::move(sequential));
  }

  const auto sequential = summarize(sequentialSamples);
  std::cout << "OpenMP thread sweep with shared sequential baseline\n"
            << "Vehicles: " << options.vehicles
            << "\nSteps: " << options.steps
            << "\nDelta time: " << options.deltaTime
            << "\nRepetitions: " << options.repetitions
            << "\nAvailable processors: "
            << neon_rush::availableThreadCount()
            << "\nMatching state and collision counts: yes\n";
  printRun("Sequential", sequential, 1);

  for (std::size_t index = 0;
       index < threadCounts.size();
       ++index) {
    const auto parallel = summarize(parallelSamples[index]);
    const double speedup =
        parallel.totalSeconds > 0.0
            ? sequential.totalSeconds / parallel.totalSeconds
            : 0.0;
    std::cout << '\n';
    printRun("OpenMP", parallel, threadCounts[index]);
    std::cout << "  Speedup S(p): " << speedup << '\n'
              << "  Efficiency E(p): "
              << speedup / threadCounts[index] << '\n';
  }
}

#ifdef NEON_RUSH_HAS_MPI
Sample runSequentialForMpiComparison(const Options& options) {
  const auto start = std::chrono::steady_clock::now();
  auto simulation = neon_rush::Simulation::create(
      options.vehicles, neon_rush::ExecutionMode::Sequential, 1);
  simulation.run(options.steps, options.deltaTime);
  const auto finish = std::chrono::steady_clock::now();

  Sample sample;
  sample.movementSeconds =
      simulation.state().vehicleUpdateSeconds;
  sample.collisionSeconds =
      simulation.state().collisionDetectionSeconds;
  sample.totalSeconds =
      std::chrono::duration<double>(finish - start).count();
  sample.collisions = simulation.state().collisionCount;
  sample.vehicles = simulation.vehicles();
  sample.checksum = checksum(sample.vehicles);
  return sample;
}

Sample runMpiOnce(const Options& options, const bool gatherForComparison) {
  const double start = MPI_Wtime();
  auto simulation = neon_rush::MpiSimulation::create(
      options.vehicles, MPI_COMM_WORLD);
  simulation.run(options.steps, options.deltaTime);
  const double localElapsed = MPI_Wtime() - start;
  double slowestElapsed = 0.0;
  MPI_Reduce(
      &localElapsed,
      &slowestElapsed,
      1,
      MPI_DOUBLE,
      MPI_MAX,
      0,
      MPI_COMM_WORLD);

  Sample sample;
  sample.movementSeconds =
      simulation.state().vehicleUpdateSeconds;
  sample.collisionSeconds =
      simulation.state().collisionDetectionSeconds;
  sample.totalSeconds = slowestElapsed;
  sample.communicationSeconds =
      simulation.state().communicationSeconds;
  sample.collisions = simulation.state().collisionCount;
  sample.checksum = simulation.globalChecksum();
  if (gatherForComparison) {
    sample.vehicles = simulation.gatherVehicles();
    sample.collisionPairs = simulation.gatherLastCollisionPairs();
  }
  return sample;
}

bool matchesSequential(const Sample& sequential,
                       const Sample& distributed,
                       const std::size_t steps) {
  if (sequential.collisions != distributed.collisions ||
      sequential.vehicles.size() != distributed.vehicles.size()) {
    return false;
  }

  for (std::size_t index = 0;
       index < sequential.vehicles.size();
       ++index) {
    const auto& expected = sequential.vehicles[index];
    const auto& actual = distributed.vehicles[index];
    if (expected.id != actual.id || expected.x != actual.x ||
        expected.z != actual.z || expected.speed != actual.speed ||
        expected.direction != actual.direction ||
        expected.collisionRadius != actual.collisionRadius ||
        expected.active != actual.active) {
      return false;
    }
  }

  std::vector<neon_rush::GlobalCollisionPair> expectedPairs;
  if (steps > 0) {
    neon_rush::CollisionSystem collisionSystem;
    const auto pairs = collisionSystem.detect(sequential.vehicles);
    expectedPairs.reserve(pairs.size());
    for (const auto& pair : pairs) {
      const auto firstId = static_cast<std::uint64_t>(
          sequential.vehicles[pair.firstIndex].id);
      const auto secondId = static_cast<std::uint64_t>(
          sequential.vehicles[pair.secondIndex].id);
      expectedPairs.push_back({
          std::min(firstId, secondId), std::max(firstId, secondId)});
    }
  }
  std::sort(expectedPairs.begin(), expectedPairs.end(),
            [](const auto& first, const auto& second) {
              return first.firstId == second.firstId
                         ? first.secondId < second.secondId
                         : first.firstId < second.firstId;
            });
  return expectedPairs == distributed.collisionPairs;
}

void runMpiMode(const Options& options,
                const int rank,
                const int processCount) {
  std::array<char, MPI_MAX_PROCESSOR_NAME> localProcessorName{};
  int localProcessorNameLength = 0;
  MPI_Get_processor_name(
      localProcessorName.data(), &localProcessorNameLength);
  std::vector<char> processorNames;
  std::vector<int> processorNameLengths;
  if (rank == 0) {
    processorNames.resize(
        static_cast<std::size_t>(processCount) *
        static_cast<std::size_t>(MPI_MAX_PROCESSOR_NAME));
    processorNameLengths.resize(static_cast<std::size_t>(processCount));
  }
  MPI_Gather(
      localProcessorName.data(),
      MPI_MAX_PROCESSOR_NAME,
      MPI_CHAR,
      rank == 0 ? processorNames.data() : nullptr,
      MPI_MAX_PROCESSOR_NAME,
      MPI_CHAR,
      0,
      MPI_COMM_WORLD);
  MPI_Gather(
      &localProcessorNameLength,
      1,
      MPI_INT,
      rank == 0 ? processorNameLengths.data() : nullptr,
      1,
      MPI_INT,
      0,
      MPI_COMM_WORLD);

  std::vector<Sample> sequentialSamples;
  std::vector<Sample> mpiSamples;
  if (rank == 0 && options.compareMpi) {
    sequentialSamples.reserve(options.repetitions);
  }
  mpiSamples.reserve(options.repetitions);
  bool allRunsMatch = true;

  for (std::size_t repetition = 0;
       repetition < options.repetitions;
       ++repetition) {
    Sample sequential;
    if (options.compareMpi) {
      MPI_Barrier(MPI_COMM_WORLD);
      if (rank == 0) {
        sequential = runSequentialForMpiComparison(options);
        sequentialSamples.push_back(sequential);
      }
      MPI_Barrier(MPI_COMM_WORLD);
    }

    auto distributed = runMpiOnce(options, options.compareMpi);
    if (options.compareMpi) {
      int matches = 1;
      if (rank == 0) {
        matches = matchesSequential(
                      sequential, distributed, options.steps)
                      ? 1
                      : 0;
      }
      MPI_Bcast(&matches, 1, MPI_INT, 0, MPI_COMM_WORLD);
      allRunsMatch = allRunsMatch && matches == 1;
      if (matches == 0) {
        break;
      }
    }
    mpiSamples.push_back(std::move(distributed));
  }

  int localSuccess = allRunsMatch ? 1 : 0;
  int globalSuccess = 0;
  MPI_Allreduce(
      &localSuccess, &globalSuccess, 1, MPI_INT, MPI_MIN, MPI_COMM_WORLD);
  if (globalSuccess == 0) {
    throw std::runtime_error(
        "MPI state or collision pairs differ from the sequential baseline");
  }
  if (rank != 0) {
    return;
  }

  std::cout << "Vehicles: " << options.vehicles
            << "\nSteps: " << options.steps
            << "\nDelta time: " << options.deltaTime
            << "\nRepetitions: " << options.repetitions
            << "\nMPI processes: " << processCount
            << "\nMode: " << (options.compareMpi ? "MPI comparison" : "MPI")
            << "\nMPI rank placement:\n";
  for (int processRank = 0; processRank < processCount; ++processRank) {
    const auto offset =
        static_cast<std::size_t>(processRank) *
        static_cast<std::size_t>(MPI_MAX_PROCESSOR_NAME);
    std::cout << "  rank " << processRank << ": "
              << std::string(
                     processorNames.data() + offset,
                     static_cast<std::size_t>(
                         processorNameLengths[
                             static_cast<std::size_t>(processRank)]))
              << '\n';
  }
  const auto mpi = summarize(mpiSamples);
  printRun("MPI", mpi, processCount, true);
  if (options.compareMpi) {
    const auto sequential = summarize(sequentialSamples);
    const double speedup =
        mpi.totalSeconds > 0.0
            ? sequential.totalSeconds / mpi.totalSeconds
            : 0.0;
    std::cout << "  Sequential/MPI state and collision pairs match: yes\n";
    printRun("Sequential", sequential, 1);
    std::cout << "  Speedup S(p): " << speedup << '\n'
              << "  Efficiency E(p): " << speedup / processCount << '\n';
  }
}
#endif

}  // namespace

int main(int argc, char** argv) {
#ifdef NEON_RUSH_HAS_MPI
  MPI_Init(&argc, &argv);
  int rank = 0;
  int processCount = 1;
  MPI_Comm_rank(MPI_COMM_WORLD, &rank);
  MPI_Comm_size(MPI_COMM_WORLD, &processCount);
#else
  constexpr int rank = 0;
  constexpr int processCount = 1;
#endif
  int exitCode = EXIT_SUCCESS;
  try {
    const auto options = parseOptions(argc, argv);
    if (processCount > 1 &&
        options.mode != neon_rush::ExecutionMode::MPI) {
      throw std::invalid_argument(
          "multiple MPI processes require --mode mpi or --mode mpi-compare");
    }

    if (rank == 0) {
      std::cout << std::fixed << std::setprecision(9);
    }
    if (options.help) {
      if (rank == 0) {
        printHelp();
      }
    } else if (options.mode == neon_rush::ExecutionMode::MPI) {
#ifdef NEON_RUSH_HAS_MPI
      runMpiMode(options, rank, processCount);
#endif
    } else if (rank == 0 && options.sweep) {
      runSweep(options);
    } else if (rank == 0 && options.compare) {
      runComparison(options);
    } else if (rank == 0) {
      runSingleMode(options);
    }
  } catch (const std::exception& error) {
    if (rank == 0) {
      std::cerr << "Error: " << error.what() << '\n'
                << "Use --help to see available options.\n";
    }
    exitCode = EXIT_FAILURE;
  }

#ifdef NEON_RUSH_HAS_MPI
  MPI_Finalize();
#endif
  return exitCode;
}
