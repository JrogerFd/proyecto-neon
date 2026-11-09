#pragma once

#include <algorithm>
#include <thread>

#ifdef _OPENMP
#include <omp.h>
#endif

namespace neon_rush {

enum class ExecutionMode {
  Sequential,
  OpenMP,
  MPI
};

inline bool openMPSupported() noexcept {
#ifdef _OPENMP
  return true;
#else
  return false;
#endif
}

inline int availableThreadCount() noexcept {
#ifdef _OPENMP
  return std::max(1, omp_get_num_procs());
#else
  return std::max(
      1,
      static_cast<int>(std::thread::hardware_concurrency()));
#endif
}

}  // namespace neon_rush
